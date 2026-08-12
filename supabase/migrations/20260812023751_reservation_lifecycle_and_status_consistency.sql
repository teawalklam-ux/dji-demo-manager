-- v1.57: make overdue inventory non-reservable, keep reservation failures
-- auditable without creating fake borrow records, and queue reliable WeCom events.

alter table public.borrow_requests
  drop constraint if exists borrow_requests_status_check;
alter table public.borrow_requests
  add constraint borrow_requests_status_check check (status in (
    'pending', 'approved', 'partially_approved', 'rejected', 'cancelled',
    'borrowed', 'partially_returned', 'returned', 'overdue',
    'renewal_requested', 'revoked', 'invalidated'
  ));

alter table public.borrow_requests
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_reason text;

alter table public.borrow_request_items
  drop constraint if exists borrow_request_items_status_check;
alter table public.borrow_request_items
  add constraint borrow_request_items_status_check check (
    status in ('pending', 'reserved', 'borrowed', 'returned', 'cancelled', 'invalidated')
  );

alter table public.overdue_notifications
  drop constraint if exists overdue_notifications_notification_category_check;
alter table public.overdue_notifications
  add constraint overdue_notifications_notification_category_check
  check (notification_category in ('overdue', 'approval', 'return', 'reservation'));

create table if not exists public.reservation_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('overdue_risk', 'auto_invalidated')),
  borrow_request_id uuid not null references public.borrow_requests(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  overdue_borrow_record_id uuid references public.borrow_records(id) on delete set null,
  reservation_requester_id uuid not null references public.profiles(id),
  overdue_borrower_id uuid references public.profiles(id),
  final_approver_id uuid references public.profiles(id),
  event_date date not null,
  item_summary text not null,
  message text not null,
  wecom_status text not null default 'pending'
    check (wecom_status in ('pending', 'processing', 'sent', 'partial', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reservation_events_delivery
  on public.reservation_events (wecom_status, next_attempt_at, created_at);
create index if not exists idx_reservation_events_request
  on public.reservation_events (borrow_request_id, created_at desc);

alter table public.reservation_events enable row level security;
revoke all on table public.reservation_events from public, anon, authenticated;
grant all on table public.reservation_events to service_role;

comment on table public.reservation_events is
  'Service-only reservation lifecycle outbox and audit trail. It never represents a physical checkout.';

create or replace function private.enqueue_reservation_event(
  p_event_key text,
  p_event_type text,
  p_borrow_request_id uuid,
  p_item_id uuid,
  p_overdue_borrow_record_id uuid,
  p_reservation_requester_id uuid,
  p_overdue_borrower_id uuid,
  p_final_approver_id uuid,
  p_event_date date,
  p_item_summary text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_id uuid;
  v_recipient_id uuid;
begin
  insert into public.reservation_events (
    event_key,
    event_type,
    borrow_request_id,
    item_id,
    overdue_borrow_record_id,
    reservation_requester_id,
    overdue_borrower_id,
    final_approver_id,
    event_date,
    item_summary,
    message
  ) values (
    p_event_key,
    p_event_type,
    p_borrow_request_id,
    p_item_id,
    p_overdue_borrow_record_id,
    p_reservation_requester_id,
    p_overdue_borrower_id,
    p_final_approver_id,
    p_event_date,
    p_item_summary,
    p_message
  )
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return false;
  end if;

  for v_recipient_id in
    select distinct recipient_id
    from unnest(
      case p_event_type
        when 'overdue_risk' then array[p_reservation_requester_id, p_overdue_borrower_id]
        else array[p_reservation_requester_id, p_final_approver_id]
      end
    ) as recipient_id
    where recipient_id is not null
  loop
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
      p_overdue_borrow_record_id,
      p_reservation_requester_id,
      'push',
      'reservation',
      v_recipient_id,
      p_borrow_request_id,
      p_message,
      false
    );
  end loop;

  return true;
end;
$function$;

revoke all on function private.enqueue_reservation_event(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, date, text, text
) from public, anon, authenticated, service_role;

create or replace function private.sync_overdue_and_queue_reservation_events(
  p_on_date date default (now() at time zone 'Asia/Shanghai')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_count integer := 0;
  v_row record;
begin
  if p_on_date is null then
    raise exception '处理日期不能为空';
  end if;

  update public.borrow_records
  set status = 'overdue',
      overdue_days = greatest(p_on_date - due_date, 0),
      updated_at = now()
  where status = 'active'
    and due_date < p_on_date;

  update public.items as item
  set status = 'overdue',
      updated_at = now()
  where item.status = 'borrowed'
    and exists (
      select 1
      from public.borrow_records as record
      where record.item_id = item.id
        and record.status = 'overdue'
    );

  update public.borrow_requests as request
  set status = 'overdue',
      updated_at = now()
  where request.status in ('borrowed', 'partially_returned')
    and exists (
      select 1
      from public.borrow_records as record
      where record.request_id = request.id
        and record.status = 'overdue'
    );

  for v_row in
    select
      reservation.id as reservation_request_id,
      reservation.request_number,
      reservation.requester_id,
      item.id as item_id,
      item.name as item_name,
      item.model as item_model,
      record.id as overdue_record_id,
      record.borrower_id as overdue_borrower_id,
      record.due_date
    from public.borrow_request_items as line
    join public.borrow_requests as reservation on reservation.id = line.request_id
    join public.items as item on item.id = line.item_id
    join lateral (
      select overdue_record.id, overdue_record.borrower_id, overdue_record.due_date
      from public.borrow_records as overdue_record
      where overdue_record.item_id = item.id
        and overdue_record.status = 'overdue'
      order by overdue_record.due_date, overdue_record.created_at
      limit 1
    ) as record on true
    where line.status = 'reserved'
      and reservation.status = 'approved'
      and reservation.expected_borrow_date > p_on_date
      and item.status = 'overdue'
  loop
    if private.enqueue_reservation_event(
      format(
        'overdue_risk:%s:%s:%s',
        v_row.reservation_request_id,
        v_row.item_id,
        v_row.overdue_record_id
      ),
      'overdue_risk',
      v_row.reservation_request_id,
      v_row.item_id,
      v_row.overdue_record_id,
      v_row.requester_id,
      v_row.overdue_borrower_id,
      null,
      p_on_date,
      format('%s（%s）', v_row.item_name, v_row.item_model),
      format(
        '预约风险：%s 所需样机 %s 前序借用已逾期（原应还 %s），请尽快协调归还。',
        v_row.request_number,
        v_row.item_name,
        v_row.due_date
      )
    ) then
      v_event_count := v_event_count + 1;
    end if;
  end loop;

  return v_event_count;
end;
$function$;

revoke all on function private.sync_overdue_and_queue_reservation_events(date)
  from public, anon, authenticated, service_role;

create or replace function private.activate_borrow_request_if_due(
  p_request_id uuid,
  p_on_date date default (now() at time zone 'Asia/Shanghai')::date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.borrow_requests%rowtype;
  v_unavailable text;
  v_invalidation_reason text;
  v_final_approver_id uuid;
begin
  if p_on_date is null then
    raise exception '激活日期不能为空';
  end if;

  select *
  into v_request
  from public.borrow_requests
  where id = p_request_id
  for update;

  if not found
     or v_request.status <> 'approved'
     or v_request.expected_borrow_date > p_on_date then
    return false;
  end if;

  perform 1
  from public.items as item
  join public.borrow_request_items as line on line.item_id = item.id
  where line.request_id = p_request_id
  order by item.id
  for update of item;

  if not exists (
    select 1
    from public.borrow_request_items
    where request_id = p_request_id and status = 'reserved'
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.borrow_request_items
    where request_id = p_request_id and status <> 'reserved'
  ) then
    raise exception '预约明细状态异常，无法自动出借';
  end if;

  select string_agg(
    format(
      '%s（%s）',
      item.name,
      case item.status
        when 'borrowed' then '仍在借出'
        when 'overdue' then '逾期未还'
        when 'maintenance' then '维修中'
        when 'retired' then '已退役'
        else item.status
      end
    ),
    '、'
    order by item.name
  )
  into v_unavailable
  from public.items as item
  join public.borrow_request_items as line on line.item_id = item.id
  where line.request_id = p_request_id
    and item.status <> 'in_stock';

  if v_unavailable is not null then
    v_invalidation_reason := format(
      '预约单 %s 在预计借出日无法履约，已自动失效：%s。未生成实际借出记录。',
      v_request.request_number,
      v_unavailable
    );

    select approval.approver_id
    into v_final_approver_id
    from public.approval_records as approval
    where approval.request_id = v_request.id
      and approval.action = 'approved'
    order by approval.step_level desc, approval.acted_at desc nulls last
    limit 1;

    update public.borrow_request_items
    set status = 'invalidated',
        updated_at = now()
    where request_id = v_request.id
      and status = 'reserved';

    update public.borrow_requests
    set status = 'invalidated',
        invalidated_at = now(),
        invalidation_reason = v_invalidation_reason,
        updated_at = now()
    where id = v_request.id;

    perform private.enqueue_reservation_event(
      format('auto_invalidated:%s', v_request.id),
      'auto_invalidated',
      v_request.id,
      null,
      null,
      v_request.requester_id,
      null,
      v_final_approver_id,
      p_on_date,
      v_unavailable,
      v_invalidation_reason
    );

    return false;
  end if;

  insert into public.borrow_records (
    request_id,
    request_item_id,
    item_id,
    borrower_id,
    borrow_type,
    borrow_date,
    due_date,
    status
  )
  select
    v_request.id,
    line.id,
    line.item_id,
    v_request.requester_id,
    v_request.borrow_type,
    p_on_date,
    v_request.expected_return_date,
    'active'
  from public.borrow_request_items as line
  where line.request_id = v_request.id
    and line.status = 'reserved';

  update public.borrow_request_items
  set status = 'borrowed',
      actual_borrow_date = p_on_date,
      updated_at = now()
  where request_id = v_request.id
    and status = 'reserved';

  update public.items as item
  set status = 'borrowed',
      current_borrower_id = v_request.requester_id,
      updated_at = now()
  from public.borrow_request_items as line
  where line.request_id = v_request.id
    and line.item_id = item.id;

  insert into public.stock_movements (
    item_id,
    movement_type,
    borrow_record_id,
    operator_id,
    notes
  )
  select
    record.item_id,
    'borrow_out',
    record.id,
    v_request.requester_id,
    '自动出借，申请编号: ' || v_request.request_number
  from public.borrow_records as record
  where record.request_id = v_request.id;

  update public.borrow_requests
  set status = 'borrowed',
      actual_borrow_date = p_on_date,
      invalidated_at = null,
      invalidation_reason = null,
      updated_at = now()
  where id = v_request.id;

  return true;
end;
$function$;

revoke all on function private.activate_borrow_request_if_due(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.activate_due_borrow_requests(
  p_on_date date default (now() at time zone 'Asia/Shanghai')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_id uuid;
  v_activated_count integer := 0;
begin
  for v_request_id in
    select request.id
    from public.borrow_requests as request
    where request.status = 'approved'
      and request.expected_borrow_date <= p_on_date
    order by request.expected_borrow_date, request.created_at
    for update skip locked
  loop
    if private.activate_borrow_request_if_due(v_request_id, p_on_date) then
      v_activated_count := v_activated_count + 1;
    end if;
  end loop;

  return v_activated_count;
end;
$function$;

revoke all on function private.activate_due_borrow_requests(date)
  from public, anon, authenticated, service_role;
grant execute on function private.activate_due_borrow_requests(date) to service_role;

create or replace function public.process_reservation_lifecycle(
  p_on_date date default (now() at time zone 'Asia/Shanghai')::date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_risk_events integer := 0;
  v_activated integer := 0;
  v_invalidated integer := 0;
  v_request_id uuid;
begin
  v_risk_events := private.sync_overdue_and_queue_reservation_events(p_on_date);

  for v_request_id in
    select request.id
    from public.borrow_requests as request
    where request.status = 'approved'
      and request.expected_borrow_date <= p_on_date
    order by request.expected_borrow_date, request.created_at
    for update skip locked
  loop
    if private.activate_borrow_request_if_due(v_request_id, p_on_date) then
      v_activated := v_activated + 1;
    elsif exists (
      select 1
      from public.borrow_requests
      where id = v_request_id and status = 'invalidated'
    ) then
      v_invalidated := v_invalidated + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'date', p_on_date,
    'risk_events', v_risk_events,
    'activated', v_activated,
    'invalidated', v_invalidated
  );
end;
$function$;

revoke all on function public.process_reservation_lifecycle(date)
  from public, anon, authenticated;
grant execute on function public.process_reservation_lifecycle(date) to service_role;

create or replace function private.get_borrowable_item_status_details()
returns table (
  item_id uuid,
  display_status text,
  reserved_start_date date,
  reserved_end_date date,
  due_date date,
  serial_number_last4 text
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
    case
      when item.status = 'borrowed' then 'borrowed'
      when reservation.expected_borrow_date is not null then 'reserved'
      else 'in_stock'
    end,
    reservation.expected_borrow_date,
    reservation.expected_return_date,
    active_borrow.due_date,
    case
      when nullif(btrim(item.serial_number), '') is null then null
      else right(btrim(item.serial_number), 4)
    end
  from public.items as item
  left join lateral (
    select request.expected_borrow_date, request.expected_return_date
    from public.borrow_request_items as line
    join public.borrow_requests as request on request.id = line.request_id
    where line.item_id = item.id
      and line.status = 'reserved'
      and request.status = 'approved'
      and request.expected_borrow_date > (now() at time zone 'Asia/Shanghai')::date
    order by request.expected_borrow_date
    limit 1
  ) as reservation on true
  left join lateral (
    select record.due_date
    from public.borrow_records as record
    where record.item_id = item.id
      and record.status = 'active'
    order by record.due_date
    limit 1
  ) as active_borrow on true
  where item.status in ('in_stock', 'borrowed')
  order by item.name;
end;
$function$;

create or replace function private.create_borrow_request(
  p_requester_id uuid,
  p_item_ids uuid[],
  p_borrow_type text,
  p_purpose text,
  p_expected_borrow_date date,
  p_expected_return_date date,
  p_customer_name text default null,
  p_customer_contact text default null,
  p_parent_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_id uuid;
  v_chain_id uuid;
  v_chain_steps jsonb;
  v_step jsonb;
  v_approver_id uuid;
  v_first_approver_id uuid;
  v_first_step_level integer := 2147483647;
  v_unavailable text;
  v_conflicts text;
  i integer;
begin
  if auth.uid() is null or p_requester_id <> auth.uid() then
    raise exception '无权创建该申请' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_requester_id
      and profile.status = 'active'
      and nullif(btrim(profile.phone), '') is not null
  ) then
    raise exception '请先在个人资料中补充可用于企业微信 @ 的手机号';
  end if;

  if p_borrow_type is null
     or p_borrow_type <> btrim(p_borrow_type)
     or char_length(p_borrow_type) not between 1 and 50
     or p_borrow_type = 'all' then
    raise exception '借用类型无效';
  end if;

  if p_borrow_type not in ('customer', 'marketing')
     and not exists (
       select 1
       from public.approval_chains
       where borrow_type = p_borrow_type and is_active = true
     ) then
    raise exception '借用类型不存在或对应审批链已停用';
  end if;

  if p_item_ids is null
     or cardinality(p_item_ids) = 0
     or cardinality(p_item_ids) <> cardinality(
       array(select distinct id from unnest(p_item_ids) as id)
     ) then
    raise exception '请至少选择一台不同的样机';
  end if;

  if p_expected_borrow_date < (now() at time zone 'Asia/Shanghai')::date
     or p_expected_return_date < p_expected_borrow_date then
    raise exception '借用日期无效';
  end if;

  perform 1
  from public.items as item
  where item.id = any(p_item_ids)
  order by item.id
  for update;

  if (select count(*) from public.items where id = any(p_item_ids)) <> cardinality(p_item_ids) then
    raise exception '所选样机不存在';
  end if;

  select string_agg(
    format(
      '%s（%s）',
      item.name,
      case item.status
        when 'overdue' then '逾期未还，不可预定'
        when 'maintenance' then '维修中'
        when 'retired' then '已退役'
        else item.status
      end
    ),
    '、'
    order by item.name
  )
  into v_unavailable
  from public.items as item
  where item.id = any(p_item_ids)
    and item.status not in ('in_stock', 'borrowed');

  if v_unavailable is not null then
    raise exception '以下样机当前不可申请：%', v_unavailable using errcode = '23P01';
  end if;

  select string_agg(
    format('%s（%s 至 %s）', conflict.item_name, conflict.occupied_start_date, conflict.occupied_end_date),
    '、'
  )
  into v_conflicts
  from private.check_borrow_availability(
    p_item_ids,
    p_expected_borrow_date,
    p_expected_return_date,
    p_parent_request_id
  ) as conflict;

  if v_conflicts is not null then
    raise exception '以下样机的日期已被占用，无法申请：%', v_conflicts using errcode = '23P01';
  end if;

  insert into public.borrow_requests (
    requester_id,
    item_id,
    borrow_type,
    purpose,
    customer_name,
    customer_contact,
    expected_borrow_date,
    expected_return_date,
    parent_request_id,
    status
  ) values (
    p_requester_id,
    p_item_ids[1],
    p_borrow_type,
    p_purpose,
    p_customer_name,
    p_customer_contact,
    p_expected_borrow_date,
    p_expected_return_date,
    p_parent_request_id,
    case when p_parent_request_id is null then 'pending' else 'renewal_requested' end
  ) returning id into v_request_id;

  insert into public.borrow_request_items (request_id, item_id)
  select v_request_id, id from unnest(p_item_ids) as id;

  select id, steps
  into v_chain_id, v_chain_steps
  from public.approval_chains
  where borrow_type in (p_borrow_type, 'all') and is_active = true
  order by
    case when borrow_type = p_borrow_type then 0 else 1 end,
    created_at
  limit 1;

  if v_chain_id is null then
    perform public.reserve_borrow_request(v_request_id);
    return v_request_id;
  end if;

  for i in 0..jsonb_array_length(v_chain_steps) - 1 loop
    v_step := v_chain_steps -> i;
    v_approver_id := null;

    if v_step ->> 'type' = 'person' then
      v_approver_id := (v_step ->> 'user_id')::uuid;
    else
      select id into v_approver_id
      from public.profiles
      where role = v_step ->> 'role' and is_active = true
      order by created_at
      limit 1;

      if v_approver_id is null then
        select id into v_approver_id
        from public.profiles
        where role in ('super_admin', 'admin') and is_active = true
        order by case role when 'super_admin' then 0 else 1 end, created_at
        limit 1;
      end if;
    end if;

    insert into public.approval_records (request_id, chain_id, approver_id, step_level)
    values (v_request_id, v_chain_id, v_approver_id, (v_step ->> 'level')::integer);

    if v_approver_id is not null
       and (v_step ->> 'level')::integer < v_first_step_level then
      v_first_approver_id := v_approver_id;
      v_first_step_level := (v_step ->> 'level')::integer;
    end if;
  end loop;

  if v_first_approver_id is not null then
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
      v_first_approver_id,
      v_request_id,
      format(
        '新审批申请：%s，%s 台样机，借用日期：%s 至 %s',
        p_borrow_type,
        cardinality(p_item_ids),
        p_expected_borrow_date,
        p_expected_return_date
      ),
      false
    );
  end if;

  return v_request_id;
end;
$function$;

create or replace function public.reserve_borrow_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.borrow_requests%rowtype;
  v_unavailable text;
  v_conflicts text;
begin
  select *
  into v_request
  from public.borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception '申请不存在';
  end if;

  perform 1
  from public.items as item
  where item.id in (
    select line.item_id
    from public.borrow_request_items as line
    where line.request_id = p_request_id
  )
  order by item.id
  for update;

  select string_agg(
    format(
      '%s（%s）',
      item.name,
      case item.status
        when 'overdue' then '逾期未还，不可预定'
        when 'maintenance' then '维修中'
        when 'retired' then '已退役'
        else item.status
      end
    ),
    '、'
    order by item.name
  )
  into v_unavailable
  from public.items as item
  join public.borrow_request_items as line on line.item_id = item.id
  where line.request_id = p_request_id
    and item.status not in ('in_stock', 'borrowed');

  if v_unavailable is not null then
    raise exception '以下样机当前不可预定：%', v_unavailable using errcode = '23P01';
  end if;

  select string_agg(
    format('%s（%s 至 %s）', conflict.item_name, conflict.occupied_start_date, conflict.occupied_end_date),
    '、'
  )
  into v_conflicts
  from private.check_borrow_availability(
    array(
      select line.item_id
      from public.borrow_request_items as line
      where line.request_id = p_request_id
    ),
    v_request.expected_borrow_date,
    v_request.expected_return_date,
    p_request_id
  ) as conflict;

  if v_conflicts is not null then
    raise exception '以下样机的日期已审批通过，无法申请：%', v_conflicts using errcode = '23P01';
  end if;

  update public.borrow_request_items
  set status = 'reserved',
      updated_at = now()
  where request_id = p_request_id
    and status = 'pending';

  update public.borrow_requests
  set status = 'approved',
      invalidated_at = null,
      invalidation_reason = null,
      updated_at = now()
  where id = p_request_id;
end;
$function$;

revoke all on function public.reserve_borrow_request(uuid)
  from public, anon, authenticated, service_role;

drop function if exists public.get_dashboard_summary();
create function public.get_dashboard_summary()
returns table (
  total bigint,
  in_stock bigint,
  reserved bigint,
  borrowed bigint,
  overdue bigint,
  maintenance bigint,
  retired bigint,
  monthly_requests bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  return query
  with item_counts as (
    select
      count(*)::bigint as total_count,
      count(*) filter (where item.status = 'in_stock')::bigint as physical_in_stock_count,
      count(*) filter (where item.status = 'borrowed')::bigint as borrowed_count,
      count(*) filter (where item.status = 'overdue')::bigint as overdue_count,
      count(*) filter (where item.status = 'maintenance')::bigint as maintenance_count,
      count(*) filter (where item.status = 'retired')::bigint as retired_count
    from public.items as item
  ),
  reserved_counts as (
    select count(*)::bigint as reserved_count
    from public.get_reserved_item_ids()
  ),
  request_counts as (
    select count(*)::bigint as monthly_request_count
    from public.borrow_requests as request
    where request.created_at >= (
      date_trunc('month', now() at time zone 'Asia/Shanghai')
      at time zone 'Asia/Shanghai'
    )
  )
  select
    item_counts.total_count,
    greatest(item_counts.physical_in_stock_count - reserved_counts.reserved_count, 0::bigint),
    reserved_counts.reserved_count,
    item_counts.borrowed_count,
    item_counts.overdue_count,
    item_counts.maintenance_count,
    item_counts.retired_count,
    request_counts.monthly_request_count
  from item_counts
  cross join reserved_counts
  cross join request_counts;
end;
$function$;

revoke all on function public.get_dashboard_summary() from public, anon;
grant execute on function public.get_dashboard_summary() to authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'activate_due_borrow_requests_daily',
  'process_reservation_lifecycle_daily',
  'notify_reservation_events'
);

select cron.schedule(
  'process_reservation_lifecycle_daily',
  '1 16 * * *',
  $$select public.process_reservation_lifecycle((now() at time zone 'Asia/Shanghai')::date);$$
);

do $function$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'publishable_key') then
    perform cron.schedule(
      'notify_reservation_events',
      '*/5 * * * *',
      $schedule$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'project_url'
        ) || '/functions/v1/notify-reservation-events',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'publishable_key'
          )
        ),
        body := '{}'::jsonb
      ) as request_id;
      $schedule$
    );
  else
    raise warning 'project_url/publishable_key Vault secrets missing; reservation event notifier was not scheduled';
  end if;
end;
$function$;
