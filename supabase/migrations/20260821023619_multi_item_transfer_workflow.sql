-- Multi-item transfer workflow.
-- A transfer request keeps the original request immutable and links every new
-- request line to the active/overdue borrow record whose custody is transferred.

set local lock_timeout = '5s';

alter table public.borrow_requests
  drop constraint if exists borrow_requests_status_check;
alter table public.borrow_requests
  add constraint borrow_requests_status_check check (status in (
    'pending', 'approved', 'partially_approved', 'rejected', 'cancelled',
    'borrowed', 'partially_returned', 'partially_transferred', 'returned',
    'transferred', 'overdue', 'renewal_requested', 'revoked', 'invalidated'
  ));

alter table public.borrow_request_items
  drop constraint if exists borrow_request_items_status_check;
alter table public.borrow_request_items
  add constraint borrow_request_items_status_check check (
    status in (
      'pending', 'reserved', 'borrowed', 'returned', 'transferred',
      'cancelled', 'invalidated', 'revoked'
    )
  );

alter table public.borrow_records
  drop constraint if exists borrow_records_status_check;
alter table public.borrow_records
  add constraint borrow_records_status_check check (
    status in ('active', 'returned', 'transferred', 'overdue', 'revoked')
  );

alter table public.stock_movements
  drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements
  add constraint stock_movements_movement_type_check check (
    movement_type in (
      'borrow_out', 'return_in', 'new_entry', 'maintenance', 'retire',
      'revoke', 'transfer'
    )
  );

alter table public.approval_records
  add column if not exists step_label text;

update public.approval_records as approval
set step_label = step ->> 'label'
from public.approval_chains as chain
cross join lateral jsonb_array_elements(chain.steps) as step
where approval.chain_id = chain.id
  and (step ->> 'level')::integer = approval.step_level
  and approval.step_label is null;

alter table public.borrow_request_items
  add column if not exists source_borrow_record_id uuid
    references public.borrow_records(id) on delete restrict;

alter table public.borrow_records
  add column if not exists transferred_from_record_id uuid
    references public.borrow_records(id) on delete restrict;

create index if not exists borrow_request_items_source_record_idx
  on public.borrow_request_items (source_borrow_record_id)
  where source_borrow_record_id is not null;

create unique index if not exists borrow_request_items_live_transfer_source_uidx
  on public.borrow_request_items (source_borrow_record_id)
  where source_borrow_record_id is not null
    and status in ('pending', 'reserved', 'borrowed');

create unique index if not exists borrow_records_transferred_from_uidx
  on public.borrow_records (transferred_from_record_id)
  where transferred_from_record_id is not null;

-- The item row remains a convenient cache, while this constraint makes the
-- actual custody record canonical and prevents concurrent double checkout.
create unique index if not exists borrow_records_one_live_custody_per_item_uidx
  on public.borrow_records (item_id)
  where status in ('active', 'overdue');

comment on column public.borrow_request_items.source_borrow_record_id is
  'For transfer requests, the active/overdue custody record being transferred.';
comment on column public.borrow_records.transferred_from_record_id is
  'Previous custody record when this borrow record was created by an approved transfer.';
comment on column public.approval_records.step_label is
  'Immutable label snapshot used by composed/dynamic approval flows.';

create or replace function private.is_request_approver(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.approval_records as approval
      where approval.request_id = p_request_id
        and approval.approver_id = (select auth.uid())
    );
$function$;

create or replace function private.can_view_borrow_record(p_record_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
begin
  if v_user_id is null then
    return false;
  end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user_id;

  if v_role in ('super_admin', 'admin', 'approver') then
    return true;
  end if;

  return exists (
    select 1
    from public.borrow_records as record
    where record.id = p_record_id
      and record.borrower_id = v_user_id
  ) or exists (
    select 1
    from public.borrow_request_items as line
    join public.borrow_requests as request on request.id = line.request_id
    where line.source_borrow_record_id = p_record_id
      and request.requester_id = v_user_id
  ) or exists (
    select 1
    from public.borrow_records as successor
    join public.borrow_records as source on source.id = successor.transferred_from_record_id
    where successor.id = p_record_id
      and source.borrower_id = v_user_id
  ) or exists (
    select 1
    from public.borrow_records as successor
    where successor.transferred_from_record_id = p_record_id
      and successor.borrower_id = v_user_id
  );
end;
$function$;

revoke all on function private.is_request_approver(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.can_view_borrow_record(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.is_request_approver(uuid) to authenticated;
grant execute on function private.can_view_borrow_record(uuid) to authenticated;

drop policy if exists "用户可查看自己的申请" on public.borrow_requests;
create policy "用户可查看自己的申请"
  on public.borrow_requests
  for select
  to authenticated
  using (
    requester_id = (select auth.uid())
    or (select private.get_current_user_role()) in ('super_admin', 'admin', 'approver')
    or (select private.is_request_approver(id))
  );

drop policy if exists "借用人或管理员可查看借用记录" on public.borrow_records;
create policy "借用人或管理员可查看借用记录"
  on public.borrow_records
  for select
  to authenticated
  using ((select private.can_view_borrow_record(id)));

create or replace function private.get_transferable_item_status_details()
returns table (
  item_id uuid,
  source_borrow_record_id uuid,
  source_borrower_id uuid,
  source_borrower_name text,
  source_borrow_status text,
  due_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  return query
  select
    item.id,
    record.id,
    record.borrower_id,
    borrower.display_name,
    record.status,
    record.due_date
  from public.items as item
  join public.borrow_records as record
    on record.item_id = item.id
   and record.status in ('active', 'overdue')
  join public.profiles as borrower on borrower.id = record.borrower_id
  where item.status in ('borrowed', 'overdue')
    and item.current_borrower_id = record.borrower_id
    and record.borrower_id <> auth.uid()
    and borrower.status = 'active'
    and borrower.is_active = true
    and not exists (
      select 1
      from public.borrow_request_items as transfer_line
      where transfer_line.source_borrow_record_id = record.id
        and transfer_line.status in ('pending', 'reserved', 'borrowed')
    )
  order by borrower.display_name, item.name;
end;
$function$;

create or replace function public.get_transferable_item_status_details()
returns table (
  item_id uuid,
  source_borrow_record_id uuid,
  source_borrower_id uuid,
  source_borrower_name text,
  source_borrow_status text,
  due_date date
)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform private.require_current_user_active();
  return query select * from private.get_transferable_item_status_details();
end;
$function$;

revoke all on function private.get_transferable_item_status_details()
from public, anon, authenticated, service_role;
revoke all on function public.get_transferable_item_status_details()
from public, anon, authenticated, service_role;
grant execute on function private.get_transferable_item_status_details() to authenticated;
grant execute on function public.get_transferable_item_status_details() to authenticated;

-- Existing availability calculations must continue to account for the lines
-- that remain with the original borrower after a partial transfer.
create or replace function private.check_borrow_availability(
  p_item_ids uuid[],
  p_expected_borrow_date date,
  p_expected_return_date date,
  p_exclude_request_id uuid default null
)
returns table (
  item_id uuid,
  item_name text,
  occupied_start_date date,
  occupied_end_date date,
  occupied_status text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if auth.uid() is null then
    raise exception '未登录' using errcode = '42501';
  end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    raise exception '请至少选择一台样机';
  end if;
  if p_expected_borrow_date is null
     or p_expected_return_date is null
     or p_expected_return_date < p_expected_borrow_date then
    raise exception '借用日期无效';
  end if;

  return query
  select distinct on (line.item_id)
    line.item_id,
    item.name,
    request.expected_borrow_date,
    request.expected_return_date,
    request.status
  from public.borrow_request_items as line
  join public.borrow_requests as request on request.id = line.request_id
  join public.items as item on item.id = line.item_id
  left join public.borrow_records as custody
    on custody.request_item_id = line.id
   and custody.status in ('active', 'overdue')
  where line.item_id = any(p_item_ids)
    and line.status in ('reserved', 'borrowed')
    and request.status in (
      'approved', 'borrowed', 'partially_returned',
      'partially_transferred', 'overdue'
    )
    and (p_exclude_request_id is null or request.id <> p_exclude_request_id)
    and (
      (custody.status = 'overdue' and p_expected_return_date >= v_today)
      or (
        request.expected_borrow_date <= p_expected_return_date
        and request.expected_return_date >= p_expected_borrow_date
      )
    )
  order by line.item_id, request.expected_borrow_date;
end;
$function$;

create or replace function private.create_transfer_request(
  p_requester_id uuid,
  p_item_ids uuid[],
  p_purpose text,
  p_expected_return_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_request_id uuid;
  v_source_borrower_id uuid;
  v_chain_id uuid;
  v_chain_steps jsonb;
  v_max_borrow_days integer;
  v_step jsonb;
  v_approver_id uuid;
  v_conflicts text;
  v_source_record_ids uuid[];
  i integer;
begin
  if auth.uid() is null or p_requester_id <> auth.uid() then
    raise exception '无权创建该转借申请' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_requester_id
      and profile.status = 'active'
      and profile.is_active = true
      and nullif(btrim(profile.phone), '') is not null
  ) then
    raise exception '请先在个人资料中补充可用于企业微信 @ 的手机号';
  end if;

  if p_item_ids is null
     or cardinality(p_item_ids) = 0
     or cardinality(p_item_ids) <> cardinality(
       array(select distinct id from unnest(p_item_ids) as id)
     ) then
    raise exception '请至少选择一台不同的样机';
  end if;

  if nullif(btrim(p_purpose), '') is null then
    raise exception '请填写转借用途';
  end if;

  if p_expected_return_date is null or p_expected_return_date < v_today then
    raise exception '预计归还日期不能早于今天';
  end if;

  select chain.id, chain.steps, chain.max_borrow_days
  into v_chain_id, v_chain_steps, v_max_borrow_days
  from public.approval_chains as chain
  where chain.borrow_type in ('customer', 'all')
    and chain.is_active = true
  order by
    case when chain.borrow_type = 'customer' then 0 else 1 end,
    chain.created_at
  limit 1;

  if v_chain_id is null or jsonb_array_length(v_chain_steps) = 0 then
    raise exception '客户借用审批链未启用，无法创建转借申请';
  end if;

  if v_max_borrow_days is not null
     and (p_expected_return_date - v_today + 1) > v_max_borrow_days then
    raise exception '转借天数超过客户借用审批链允许的上限（% 天）', v_max_borrow_days;
  end if;

  -- Use the same record-then-item lock order as return and final transfer.
  perform 1
  from public.borrow_records as record
  where record.item_id = any(p_item_ids)
    and record.status in ('active', 'overdue')
  order by record.item_id, record.id
  for update;

  perform 1
  from public.items as item
  where item.id = any(p_item_ids)
  order by item.id
  for update;

  if (select count(*) from public.items where id = any(p_item_ids)) <> cardinality(p_item_ids) then
    raise exception '所选样机不存在';
  end if;

  select
    array_agg(record.id order by record.item_id),
    (array_agg(record.borrower_id order by record.item_id))[1]
  into v_source_record_ids, v_source_borrower_id
  from public.borrow_records as record
  join public.profiles as borrower on borrower.id = record.borrower_id
  where record.item_id = any(p_item_ids)
    and record.status in ('active', 'overdue');

  if cardinality(coalesce(v_source_record_ids, array[]::uuid[])) <> cardinality(p_item_ids) then
    raise exception '所选设备中包含当前没有有效借用记录的设备' using errcode = '23P01';
  end if;

  if (
    select count(distinct record.borrower_id)
    from public.borrow_records as record
    where record.id = any(v_source_record_ids)
  ) <> 1 then
    raise exception '同一张转借申请中的设备必须属于同一当前借用人' using errcode = '23P01';
  end if;

  if v_source_borrower_id = p_requester_id then
    raise exception '当前借用人不能向自己提交转借申请';
  end if;

  if not exists (
    select 1
    from public.profiles as borrower
    where borrower.id = v_source_borrower_id
      and borrower.status = 'active'
      and borrower.is_active = true
  ) then
    raise exception '当前借用人账号不可用，请由管理员先处理原借用记录';
  end if;

  if exists (
    select 1
    from public.items as item
    join public.borrow_records as record
      on record.item_id = item.id
     and record.id = any(v_source_record_ids)
    where item.id = any(p_item_ids)
      and (
        item.status not in ('borrowed', 'overdue')
        or item.current_borrower_id is distinct from record.borrower_id
      )
  ) then
    raise exception '设备当前状态或借用人已经变化，请刷新后重试' using errcode = '23P01';
  end if;

  if exists (
    select 1
    from public.borrow_request_items as line
    where line.source_borrow_record_id = any(v_source_record_ids)
      and line.status in ('pending', 'reserved', 'borrowed')
  ) then
    raise exception '所选设备已有进行中的转借申请' using errcode = '23P01';
  end if;

  select string_agg(
    format('%s（已预约 %s 至 %s）', item.name, request.expected_borrow_date, request.expected_return_date),
    '、' order by item.name
  )
  into v_conflicts
  from public.borrow_request_items as line
  join public.borrow_requests as request on request.id = line.request_id
  join public.items as item on item.id = line.item_id
  where line.item_id = any(p_item_ids)
    and line.status = 'reserved'
    and request.status = 'approved'
    and request.expected_borrow_date <= p_expected_return_date
    and request.expected_return_date >= v_today;

  if v_conflicts is not null then
    raise exception '转借期限与已有预约冲突：%', v_conflicts using errcode = '23P01';
  end if;

  insert into public.borrow_requests (
    requester_id,
    item_id,
    borrow_type,
    purpose,
    expected_borrow_date,
    expected_return_date,
    status
  ) values (
    p_requester_id,
    p_item_ids[1],
    'transfer',
    btrim(p_purpose),
    v_today,
    p_expected_return_date,
    'pending'
  ) returning id into v_request_id;

  insert into public.borrow_request_items (
    request_id,
    item_id,
    source_borrow_record_id
  )
  select v_request_id, record.item_id, record.id
  from public.borrow_records as record
  where record.id = any(v_source_record_ids)
  order by record.item_id;

  insert into public.approval_records (
    request_id,
    chain_id,
    approver_id,
    step_level,
    step_label
  ) values (
    v_request_id,
    v_chain_id,
    v_source_borrower_id,
    1,
    '当前借用人确认'
  );

  for i in 0..jsonb_array_length(v_chain_steps) - 1 loop
    v_step := v_chain_steps -> i;
    v_approver_id := null;

    if v_step ->> 'type' = 'person' then
      select profile.id into v_approver_id
      from public.profiles as profile
      where profile.id = (v_step ->> 'user_id')::uuid
        and profile.status = 'active'
        and profile.is_active = true;
    else
      select profile.id into v_approver_id
      from public.profiles as profile
      where profile.role = v_step ->> 'role'
        and profile.status = 'active'
        and profile.is_active = true
      order by profile.created_at
      limit 1;

      if v_approver_id is null then
        select profile.id into v_approver_id
        from public.profiles as profile
        where profile.role in ('super_admin', 'admin')
          and profile.status = 'active'
          and profile.is_active = true
        order by
          case profile.role when 'super_admin' then 0 else 1 end,
          profile.created_at
        limit 1;
      end if;
    end if;

    if v_approver_id is null then
      raise exception '客户借用审批链第 % 步没有可用审批人', (v_step ->> 'level')::integer;
    end if;

    insert into public.approval_records (
      request_id,
      chain_id,
      approver_id,
      step_level,
      step_label
    ) values (
      v_request_id,
      v_chain_id,
      v_approver_id,
      (v_step ->> 'level')::integer + 1,
      v_step ->> 'label'
    );
  end loop;

  insert into public.overdue_notifications (
    borrow_record_id,
    borrower_id,
    notification_type,
    notification_category,
    recipient_id,
    borrow_request_id,
    message,
    is_read
  ) values (
    null,
    p_requester_id,
    'push',
    'approval',
    v_source_borrower_id,
    v_request_id,
    format(
      '转借确认：%s 申请接收您当前借用的 %s 台设备',
      (select profile.display_name from public.profiles as profile where profile.id = p_requester_id),
      cardinality(p_item_ids)
    ),
    false
  );

  return v_request_id;
end;
$function$;

create or replace function public.create_transfer_request(
  p_requester_id uuid,
  p_item_ids uuid[],
  p_purpose text,
  p_expected_return_date date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform private.require_current_user_active();
  return private.create_transfer_request(
    p_requester_id,
    p_item_ids,
    p_purpose,
    p_expected_return_date
  );
end;
$function$;

revoke all on function private.create_transfer_request(uuid, uuid[], text, date)
from public, anon, authenticated, service_role;
revoke all on function public.create_transfer_request(uuid, uuid[], text, date)
from public, anon, authenticated, service_role;
grant execute on function private.create_transfer_request(uuid, uuid[], text, date) to authenticated;
grant execute on function public.create_transfer_request(uuid, uuid[], text, date) to authenticated;

create or replace function private.refresh_borrow_request_status(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_status text;
  v_active_count integer;
  v_overdue_count integer;
  v_returned_count integer;
  v_transferred_count integer;
  v_total_count integer;
  v_next_status text;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select request.status into v_request_status
  from public.borrow_requests as request
  where request.id = p_request_id
  for update;

  if not found or v_request_status in ('revoked', 'invalidated', 'rejected', 'cancelled') then
    return v_request_status;
  end if;

  select
    count(*) filter (where record.status = 'active'),
    count(*) filter (where record.status = 'overdue'),
    count(*) filter (where record.status = 'returned'),
    count(*) filter (where record.status = 'transferred'),
    count(*) filter (where record.status in ('active', 'overdue', 'returned', 'transferred'))
  into v_active_count, v_overdue_count, v_returned_count, v_transferred_count, v_total_count
  from public.borrow_records as record
  where record.request_id = p_request_id;

  if v_active_count + v_overdue_count > 0 then
    if v_transferred_count > 0 then
      v_next_status := 'partially_transferred';
    elsif v_returned_count > 0 then
      v_next_status := 'partially_returned';
    elsif v_overdue_count > 0 then
      v_next_status := 'overdue';
    else
      v_next_status := 'borrowed';
    end if;
  elsif v_transferred_count > 0 and v_transferred_count = v_total_count then
    v_next_status := 'transferred';
  elsif v_transferred_count > 0 then
    v_next_status := 'partially_transferred';
  elsif v_returned_count > 0 then
    v_next_status := 'returned';
  else
    return v_request_status;
  end if;

  update public.borrow_requests
  set status = v_next_status,
      actual_return_date = case
        when v_active_count + v_overdue_count = 0 then coalesce(actual_return_date, v_today)
        else null
      end,
      updated_at = now()
  where id = p_request_id;

  return v_next_status;
end;
$function$;

create or replace function private.invalidate_transfer_request(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.borrow_request_items
  set status = 'invalidated',
      updated_at = now()
  where request_id = p_request_id
    and status in ('pending', 'reserved');

  update public.borrow_requests
  set status = 'invalidated',
      invalidated_at = now(),
      invalidation_reason = p_reason,
      updated_at = now()
  where id = p_request_id;
end;
$function$;

create or replace function private.finalize_transfer_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.borrow_requests%rowtype;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_source_borrower_id uuid;
  v_source_request_id uuid;
  v_reason text;
  v_conflicts text;
begin
  select * into v_request
  from public.borrow_requests
  where id = p_request_id
  for update;

  if not found or v_request.borrow_type <> 'transfer' then
    raise exception '转借申请不存在';
  end if;

  perform 1
  from public.borrow_records as source
  join public.borrow_request_items as line on line.source_borrow_record_id = source.id
  where line.request_id = p_request_id
  order by source.item_id, source.id
  for update of source;

  perform 1
  from public.items as item
  join public.borrow_request_items as line on line.item_id = item.id
  where line.request_id = p_request_id
  order by item.id
  for update of item;

  select (array_agg(source.borrower_id order by source.item_id))[1]
  into v_source_borrower_id
  from public.borrow_request_items as line
  join public.borrow_records as source on source.id = line.source_borrow_record_id
  where line.request_id = p_request_id;

  if v_request.expected_return_date < v_today then
    v_reason := '最终审批时预计归还日期已经早于当前日期';
  elsif not exists (
    select 1
    from public.profiles as requester
    where requester.id = v_request.requester_id
      and requester.status = 'active'
      and requester.is_active = true
  ) then
    v_reason := '转借申请人账号已不可用';
  elsif exists (
    select 1
    from public.borrow_request_items as line
    left join public.borrow_records as source on source.id = line.source_borrow_record_id
    left join public.items as item on item.id = line.item_id
    where line.request_id = p_request_id
      and (
        source.id is null
        or source.item_id is distinct from line.item_id
        or source.status not in ('active', 'overdue')
        or source.borrower_id is distinct from v_source_borrower_id
        or item.status not in ('borrowed', 'overdue')
        or item.current_borrower_id is distinct from source.borrower_id
      )
  ) then
    v_reason := '审批期间设备已归还、撤销或借用归属发生变化';
  end if;

  select string_agg(
    format('%s（%s 至 %s）', item.name, request.expected_borrow_date, request.expected_return_date),
    '、' order by item.name
  )
  into v_conflicts
  from public.borrow_request_items as transfer_line
  join public.borrow_request_items as reserved_line on reserved_line.item_id = transfer_line.item_id
  join public.borrow_requests as request on request.id = reserved_line.request_id
  join public.items as item on item.id = reserved_line.item_id
  where transfer_line.request_id = p_request_id
    and reserved_line.request_id <> p_request_id
    and reserved_line.status = 'reserved'
    and request.status = 'approved'
    and request.expected_borrow_date <= v_request.expected_return_date
    and request.expected_return_date >= v_today;

  if v_reason is null and v_conflicts is not null then
    v_reason := '审批期间出现新的预约冲突：' || v_conflicts;
  end if;

  if v_reason is not null then
    perform private.invalidate_transfer_request(p_request_id, v_reason);
    return false;
  end if;

  update public.borrow_records as source
  set status = 'transferred',
      return_date = v_today,
      notes = concat_ws(E'\n', nullif(source.notes, ''), '因转借结束'),
      updated_at = now()
  from public.borrow_request_items as line
  where line.request_id = p_request_id
    and line.source_borrow_record_id = source.id;

  update public.borrow_request_items as source_line
  set status = 'transferred',
      actual_return_date = v_today,
      updated_at = now()
  from public.borrow_request_items as transfer_line
  join public.borrow_records as source on source.id = transfer_line.source_borrow_record_id
  where transfer_line.request_id = p_request_id
    and source.request_item_id = source_line.id;

  insert into public.borrow_records (
    request_id,
    request_item_id,
    item_id,
    borrower_id,
    borrow_type,
    borrow_date,
    due_date,
    status,
    notes,
    transferred_from_record_id
  )
  select
    v_request.id,
    line.id,
    line.item_id,
    v_request.requester_id,
    'transfer',
    v_today,
    v_request.expected_return_date,
    'active',
    format('由借用记录 %s 转借', line.source_borrow_record_id),
    line.source_borrow_record_id
  from public.borrow_request_items as line
  where line.request_id = p_request_id
  order by line.item_id;

  update public.borrow_request_items
  set status = 'borrowed',
      actual_borrow_date = v_today,
      updated_at = now()
  where request_id = p_request_id;

  update public.items as item
  set status = 'borrowed',
      current_borrower_id = v_request.requester_id,
      updated_at = now()
  from public.borrow_request_items as line
  where line.request_id = p_request_id
    and line.item_id = item.id;

  insert into public.stock_movements (
    item_id,
    movement_type,
    borrow_record_id,
    operator_id,
    notes
  )
  select
    successor.item_id,
    'transfer',
    successor.id,
    auth.uid(),
    format(
      '转借完成 - 新申请: %s - 来源借用记录: %s',
      v_request.request_number,
      successor.transferred_from_record_id
    )
  from public.borrow_records as successor
  where successor.request_id = p_request_id;

  update public.borrow_requests
  set status = 'borrowed',
      actual_borrow_date = v_today,
      invalidated_at = null,
      invalidation_reason = null,
      updated_at = now()
  where id = p_request_id;

  for v_source_request_id in
    select distinct source.request_id
    from public.borrow_request_items as line
    join public.borrow_records as source on source.id = line.source_borrow_record_id
    where line.request_id = p_request_id
    order by source.request_id
  loop
    perform private.refresh_borrow_request_status(v_source_request_id);
  end loop;

  -- A renewal created from the old multi-item request no longer represents the
  -- same equipment set after a transfer, so close it instead of silently
  -- renewing devices now held by someone else.
  update public.borrow_request_items as renewal_line
  set status = 'invalidated',
      updated_at = now()
  where renewal_line.request_id in (
    select renewal.id
    from public.borrow_requests as renewal
    where renewal.parent_request_id in (
      select distinct source.request_id
      from public.borrow_request_items as line
      join public.borrow_records as source on source.id = line.source_borrow_record_id
      where line.request_id = p_request_id
    )
      and renewal.status in ('pending', 'partially_approved', 'renewal_requested')
  )
    and renewal_line.status in ('pending', 'reserved');

  update public.approval_records as renewal_approval
  set action = 'cancelled',
      comment = '原借用设备发生转借，续借申请自动失效',
      acted_at = coalesce(renewal_approval.acted_at, now())
  where renewal_approval.request_id in (
    select renewal.id
    from public.borrow_requests as renewal
    where renewal.parent_request_id in (
      select distinct source.request_id
      from public.borrow_request_items as line
      join public.borrow_records as source on source.id = line.source_borrow_record_id
      where line.request_id = p_request_id
    )
      and renewal.status in ('pending', 'partially_approved', 'renewal_requested')
  )
    and renewal_approval.acted_at is null;

  update public.borrow_requests as renewal
  set status = 'invalidated',
      invalidated_at = now(),
      invalidation_reason = '原借用设备发生转借，续借申请自动失效',
      updated_at = now()
  where renewal.parent_request_id in (
    select distinct source.request_id
    from public.borrow_request_items as line
    join public.borrow_records as source on source.id = line.source_borrow_record_id
    where line.request_id = p_request_id
  )
    and renewal.status in ('pending', 'partially_approved', 'renewal_requested');

  return true;
end;
$function$;

revoke all on function private.refresh_borrow_request_status(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.invalidate_transfer_request(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.finalize_transfer_request(uuid)
from public, anon, authenticated, service_role;

create or replace function private.process_approval(
  p_request_id uuid,
  p_action text,
  p_comment text default null,
  p_approver_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record public.approval_records%rowtype;
  v_approver_id uuid := auth.uid();
  v_current_step integer;
  v_is_final boolean;
  v_requester_id uuid;
  v_request_number text;
  v_request_status text;
  v_borrow_type text;
  v_next_approver_id uuid;
  v_activated boolean := false;
begin
  if v_approver_id is null or p_action not in ('approved', 'rejected') then
    raise exception 'Invalid approval request';
  end if;

  if p_approver_id is not null and p_approver_id <> v_approver_id then
    raise exception 'Approver identity does not match the signed-in user'
      using errcode = '42501';
  end if;

  select request.requester_id, request.request_number, request.status, request.borrow_type
  into v_requester_id, v_request_number, v_request_status, v_borrow_type
  from public.borrow_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Borrow request was not found';
  end if;

  if v_request_status not in ('pending', 'partially_approved', 'renewal_requested') then
    raise exception 'This approval flow is no longer pending' using errcode = '22023';
  end if;

  select min(step_level)
  into v_current_step
  from public.approval_records
  where request_id = p_request_id
    and acted_at is null;

  select *
  into v_record
  from public.approval_records
  where request_id = p_request_id
    and approver_id = v_approver_id
    and step_level = v_current_step
    and acted_at is null
  for update;

  if not found then
    raise exception 'No approval step is currently assigned to you'
      using errcode = '42501';
  end if;

  if p_action = 'rejected' then
    update public.approval_records
    set action = 'rejected', comment = p_comment, acted_at = now()
    where id = v_record.id;

    update public.approval_records
    set action = 'cancelled', acted_at = now()
    where request_id = p_request_id and acted_at is null;

    update public.borrow_request_items
    set status = 'cancelled', updated_at = now()
    where request_id = p_request_id and status in ('pending', 'reserved');

    update public.borrow_requests
    set status = 'rejected', rejection_reason = p_comment, updated_at = now()
    where id = p_request_id;

    insert into public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type, notification_category,
      recipient_id, borrow_request_id, message, is_read
    ) values (
      null, v_requester_id, 'push', 'approval', v_requester_id, p_request_id,
      '审批已拒绝：' || v_request_number, false
    );

    return v_record.id;
  end if;

  v_is_final := not exists (
    select 1
    from public.approval_records
    where request_id = p_request_id
      and acted_at is null
      and id <> v_record.id
  );

  update public.approval_records
  set action = 'approved', comment = p_comment, acted_at = now()
  where id = v_record.id;

  if v_is_final then
    if v_borrow_type = 'transfer' then
      v_activated := private.finalize_transfer_request(p_request_id);
    else
      perform public.reserve_borrow_request(p_request_id);
      v_activated := private.activate_borrow_request_if_due(
        p_request_id,
        (now() at time zone 'Asia/Shanghai')::date
      );
    end if;

    insert into public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type, notification_category,
      recipient_id, borrow_request_id, message, is_read
    ) values (
      null,
      v_requester_id,
      'push',
      'approval',
      v_requester_id,
      p_request_id,
      case
        when v_borrow_type = 'transfer' and v_activated then '转借审批通过，设备已完成交接：'
        when v_borrow_type = 'transfer' then '转借申请因设备状态变化自动失效：'
        when v_activated then '审批通过，样机已出借：'
        else '审批通过，样机已预约：'
      end || v_request_number,
      false
    );
  else
    update public.borrow_requests
    set status = 'partially_approved', updated_at = now()
    where id = p_request_id;

    select approver_id
    into v_next_approver_id
    from public.approval_records
    where request_id = p_request_id
      and acted_at is null
    order by step_level
    limit 1;

    if v_next_approver_id is not null then
      insert into public.overdue_notifications (
        borrow_record_id, borrower_id, notification_type, notification_category,
        recipient_id, borrow_request_id, message, is_read
      ) values (
        null, v_requester_id, 'push', 'approval', v_next_approver_id,
        p_request_id, '新审批申请：' || v_request_number, false
      );
    end if;
  end if;

  return v_record.id;
end;
$function$;

create or replace function private.process_return(
  p_borrow_record_id uuid,
  p_photo_storage_path text default null,
  p_photo_captured_at timestamptz default null,
  p_photo_latitude double precision default null,
  p_photo_longitude double precision default null,
  p_photo_address text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_record public.borrow_records%rowtype;
  v_role text;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if auth.uid() is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select * into v_record
  from public.borrow_records
  where id = p_borrow_record_id
  for update;

  if not found then
    raise exception '借用记录不存在';
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_record.borrower_id <> auth.uid() and v_role not in ('super_admin', 'admin') then
    raise exception '无权归还该样机' using errcode = '42501';
  end if;

  if v_record.status not in ('active', 'overdue') then
    raise exception '该借用记录已经结束，不能再次归还';
  end if;

  perform 1 from public.items where id = v_record.item_id for update;

  update public.borrow_records
  set status = 'returned',
      return_date = v_today,
      notes = coalesce(p_notes, notes),
      updated_at = now()
  where id = v_record.id;

  update public.borrow_request_items
  set status = 'returned',
      actual_return_date = v_today,
      updated_at = now()
  where id = v_record.request_item_id;

  if p_photo_storage_path is not null then
    insert into public.return_photos (
      borrow_record_id, uploader_id, storage_path, captured_at,
      latitude, longitude, address
    ) values (
      v_record.id,
      auth.uid(),
      p_photo_storage_path,
      coalesce(p_photo_captured_at, now()),
      p_photo_latitude,
      p_photo_longitude,
      p_photo_address
    );
  end if;

  update public.items
  set status = 'in_stock',
      current_borrower_id = null,
      updated_at = now()
  where id = v_record.item_id;

  insert into public.stock_movements (
    item_id, movement_type, borrow_record_id, operator_id, notes
  ) values (
    v_record.item_id,
    'return_in',
    v_record.id,
    auth.uid(),
    coalesce(p_notes, '归还样机')
  );

  perform private.refresh_borrow_request_status(v_record.request_id);
end;
$function$;

-- Direct cancellation must release source records so another transfer can be
-- requested after the applicant cancels before any approval action.
create or replace function public.handle_request_status_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (new.status = 'cancelled' and old.status <> 'cancelled')
     or (new.status = 'rejected' and old.status <> 'rejected') then
    update public.borrow_request_items
    set status = 'cancelled',
        updated_at = now()
    where request_id = new.id
      and status in ('pending', 'reserved');

    if new.status = 'cancelled' then
      update public.approval_records
      set acted_at = now(),
          action = 'cancelled',
          comment = '申请人已取消此申请'
      where request_id = new.id
        and acted_at is null;
    else
      update public.approval_records
      set acted_at = now(),
          action = 'rejected',
          comment = '前序步骤已拒绝，自动关闭'
      where request_id = new.id
        and acted_at is null;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.handle_request_status_changed()
from public, anon, authenticated, service_role;

create or replace function private.get_current_approval_progress(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_request_status text;
  v_current record;
  v_previous record;
begin
  if v_user_id is null then
    raise exception 'Login required' using errcode = '42501';
  end if;

  select profile.role into v_role
  from public.profiles as profile
  where profile.id = v_user_id;

  select request.status into v_request_status
  from public.borrow_requests as request
  where request.id = p_request_id;

  if v_request_status not in ('pending', 'partially_approved', 'renewal_requested') then
    raise exception 'This approval flow is no longer pending' using errcode = '22023';
  end if;

  select
    approval.step_level,
    approval.approver_id,
    approver.display_name,
    coalesce(
      approval.step_label,
      step ->> 'label',
      format('第 %s 级审批', approval.step_level)
    ) as step_label
  into v_current
  from public.approval_records as approval
  join public.profiles as approver on approver.id = approval.approver_id
  left join public.approval_chains as chain on chain.id = approval.chain_id
  left join lateral jsonb_array_elements(chain.steps) as step
    on (step ->> 'level')::integer = approval.step_level
  where approval.request_id = p_request_id
    and approval.acted_at is null
  order by approval.step_level
  limit 1;

  if not found then
    raise exception 'No pending approval step was found' using errcode = '22023';
  end if;

  if v_role not in ('super_admin', 'admin') and v_current.approver_id <> v_user_id then
    raise exception 'You are not the current approver for this request' using errcode = '42501';
  end if;

  select
    approval.step_level,
    approval.action,
    approval.comment,
    approval.acted_at,
    approver.display_name
  into v_previous
  from public.approval_records as approval
  join public.profiles as approver on approver.id = approval.approver_id
  where approval.request_id = p_request_id
    and approval.step_level < v_current.step_level
    and approval.acted_at is not null
  order by approval.step_level desc
  limit 1;

  return jsonb_build_object(
    'current_step', jsonb_build_object(
      'step_level', v_current.step_level,
      'approver_id', v_current.approver_id,
      'approver_name', v_current.display_name,
      'step_label', v_current.step_label
    ),
    'previous_step', case when v_previous.step_level is null then null else jsonb_build_object(
      'step_level', v_previous.step_level,
      'approver_name', v_previous.display_name,
      'action', v_previous.action,
      'comment', v_previous.comment,
      'acted_at', v_previous.acted_at
    ) end
  );
end;
$function$;

-- Revocation closes only custody that still belongs to the revoked request.
-- Devices already transferred to a separately approved successor request keep
-- their current custody and lineage; revocation never silently moves them back.
create or replace function private.revoke_approval(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.borrow_requests%rowtype;
  v_record record;
  v_operator_id uuid := auth.uid();
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
  v_revoked_at timestamptz := now();
begin
  if v_operator_id is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select role
  into v_role
  from public.profiles
  where id = v_operator_id;

  if v_role <> 'super_admin' then
    raise exception '只有超级管理员可以撤销审批' using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception '请填写撤销原因' using errcode = '22023';
  end if;

  select *
  into v_request
  from public.borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception '申请不存在' using errcode = 'P0002';
  end if;

  if v_request.status not in (
    'approved',
    'borrowed',
    'overdue',
    'partially_returned',
    'returned',
    'partially_transferred',
    'transferred'
  ) then
    raise exception '当前申请不能撤销';
  end if;

  if v_request.status = 'approved' then
    update public.borrow_request_items
    set status = 'revoked',
        updated_at = v_revoked_at
    where request_id = p_request_id
      and status in ('pending', 'reserved');
  elsif v_request.status in (
    'borrowed',
    'overdue',
    'partially_returned',
    'partially_transferred'
  ) then
    for v_record in
      select id, item_id, borrower_id, status
      from public.borrow_records
      where request_id = p_request_id
        and status in ('active', 'overdue')
      order by id
      for update
    loop
      update public.items
      set status = 'in_stock',
          current_borrower_id = null,
          updated_at = v_revoked_at
      where id = v_record.item_id
        and current_borrower_id = v_record.borrower_id;

      update public.borrow_records
      set status = 'revoked',
          revoked_at = v_revoked_at,
          revoked_by = v_operator_id,
          revocation_reason = v_reason,
          revoked_from_status = v_record.status,
          notes = concat_ws(
            E'\n',
            nullif(notes, ''),
            format('审批撤销：%s', v_reason)
          ),
          updated_at = v_revoked_at
      where id = v_record.id;

      insert into public.stock_movements (
        item_id,
        movement_type,
        borrow_record_id,
        operator_id,
        notes
      ) values (
        v_record.item_id,
        'revoke',
        v_record.id,
        v_operator_id,
        format('撤销审批 - 申请编号: %s - 原因: %s', v_request.request_number, v_reason)
      );
    end loop;

    update public.borrow_request_items
    set status = 'revoked',
        updated_at = v_revoked_at
    where request_id = p_request_id
      and status in ('pending', 'reserved', 'borrowed');
  end if;

  update public.borrow_requests
  set status = 'revoked',
      revoked_at = v_revoked_at,
      revoked_by = v_operator_id,
      revocation_reason = v_reason,
      revoked_from_status = v_request.status,
      rejection_reason = '【审批撤销】' || v_reason,
      updated_at = v_revoked_at
  where id = p_request_id;

  insert into public.overdue_notifications (
    borrow_record_id,
    borrower_id,
    notification_type,
    notification_category,
    recipient_id,
    borrow_request_id,
    message,
    is_read
  ) values (
    null,
    v_request.requester_id,
    'push',
    'approval',
    v_request.requester_id,
    p_request_id,
    format('审批已撤销：%s（原因：%s）', v_request.request_number, v_reason),
    false
  );
end;
$function$;

comment on function private.revoke_approval(uuid, text) is
  'Soft-revokes remaining custody while preserving transferred successor custody and complete approval/transfer lineage.';

notify pgrst, 'reload schema';
