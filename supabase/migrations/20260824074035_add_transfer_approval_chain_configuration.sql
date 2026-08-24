-- Give transfer requests their own editable approval chain while preserving the
-- mandatory, runtime-resolved current-borrower confirmation as step 1.

insert into public.approval_chains (
  name,
  borrow_type,
  steps,
  max_borrow_days,
  is_active
)
select
  '转借审批',
  'transfer',
  source.steps,
  source.max_borrow_days,
  true
from (
  select chain.steps, chain.max_borrow_days
  from public.approval_chains as chain
  where chain.borrow_type in ('customer', 'all')
    and chain.is_active = true
  order by
    case when chain.borrow_type = 'customer' then 0 else 1 end,
    chain.created_at
  limit 1
) as source
where not exists (
  select 1
  from public.approval_chains as existing
  where existing.borrow_type = 'transfer'
);

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
  where chain.borrow_type in ('transfer', 'all')
    and chain.is_active = true
  order by
    case when chain.borrow_type = 'transfer' then 0 else 1 end,
    chain.created_at
  limit 1;

  if v_chain_id is null or coalesce(jsonb_array_length(v_chain_steps), 0) = 0 then
    raise exception '转借审批链未启用，无法创建转借申请';
  end if;

  if v_max_borrow_days is not null
     and (p_expected_return_date - v_today + 1) > v_max_borrow_days then
    raise exception '转借天数超过转借审批链允许的上限（% 天）', v_max_borrow_days;
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
      raise exception '转借审批链第 % 步没有可用审批人', (v_step ->> 'level')::integer;
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

revoke all on function private.create_transfer_request(uuid, uuid[], text, date)
from public, anon, authenticated, service_role;
grant execute on function private.create_transfer_request(uuid, uuid[], text, date)
to authenticated;

comment on function private.create_transfer_request(uuid, uuid[], text, date) is
'Creates a transfer request using the dedicated transfer approval chain; step 1 is always the current borrower.';
