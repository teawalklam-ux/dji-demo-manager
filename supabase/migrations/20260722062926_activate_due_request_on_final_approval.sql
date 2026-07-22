-- Activate same-day/overdue reservations immediately after final approval.
-- A single private helper is shared by approval and the daily cron fallback so
-- request, item, borrow-record, and stock-movement state cannot drift.

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
  v_unavailable_message text;
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

  -- Lock physical items in a stable order so approval and cron cannot activate
  -- overlapping requests concurrently.
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

  select string_agg(item.name, '、')
    into v_unavailable
  from public.items as item
  join public.borrow_request_items as line on line.item_id = item.id
  where line.request_id = p_request_id
    and item.status <> 'in_stock';

  if v_unavailable is not null then
    v_unavailable_message := format(
      '预约单 %s 到期未自动出借：%s 当前不可用，请联系管理员处理。',
      v_request.request_number,
      v_unavailable
    );

    insert into public.overdue_notifications (
      borrow_record_id,
      borrower_id,
      notification_type,
      notification_category,
      recipient_id,
      borrow_request_id,
      message,
      is_read
    )
    select
      null,
      v_request.requester_id,
      'push',
      'approval',
      v_request.requester_id,
      v_request.id,
      v_unavailable_message,
      false
    where not exists (
      select 1
      from public.overdue_notifications as notification
      where notification.borrow_request_id = v_request.id
        and notification.message = v_unavailable_message
        and notification.is_read = false
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
      updated_at = now()
  where id = v_request.id;

  return true;
end;
$function$;

revoke all on function private.activate_borrow_request_if_due(uuid, date)
  from public, anon, authenticated, service_role;

-- Move the maintenance implementation out of the exposed API schema and leave
-- only a SECURITY INVOKER wrapper callable by service_role/pg_cron.
alter function public.activate_due_borrow_requests(date) set schema private;

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
grant usage on schema private to service_role;
grant execute on function private.activate_due_borrow_requests(date)
  to service_role;

create function public.activate_due_borrow_requests(
  p_on_date date default (now() at time zone 'Asia/Shanghai')::date
)
returns integer
language sql
security invoker
set search_path = ''
as $function$
  select private.activate_due_borrow_requests(p_on_date);
$function$;

revoke all on function public.activate_due_borrow_requests(date)
  from public, anon, authenticated, service_role;
grant execute on function public.activate_due_borrow_requests(date)
  to service_role;

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

  perform 1
  from public.borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Borrow request was not found';
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

  select requester_id, request_number
    into v_requester_id, v_request_number
  from public.borrow_requests
  where id = p_request_id;

  if p_action = 'rejected' then
    update public.approval_records
    set action = 'rejected', comment = p_comment, acted_at = now()
    where id = v_record.id;

    update public.approval_records
    set action = 'cancelled', acted_at = now()
    where request_id = p_request_id and acted_at is null;

    update public.borrow_request_items
    set status = 'cancelled'
    where request_id = p_request_id and status = 'pending';

    update public.borrow_requests
    set status = 'rejected', rejection_reason = p_comment, updated_at = now()
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
      v_requester_id,
      'push',
      'approval',
      v_requester_id,
      p_request_id,
      'Approval rejected: ' || v_request_number,
      false
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
    perform public.reserve_borrow_request(p_request_id);
    v_activated := private.activate_borrow_request_if_due(
      p_request_id,
      (now() at time zone 'Asia/Shanghai')::date
    );

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
      v_requester_id,
      'push',
      'approval',
      v_requester_id,
      p_request_id,
      case
        when v_activated then 'Approval passed, samples issued: '
        else 'Approval passed, samples reserved: '
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
        v_requester_id,
        'push',
        'approval',
        v_next_approver_id,
        p_request_id,
        'New approval request: ' || v_request_number,
        false
      );
    end if;
  end if;

  return v_record.id;
end;
$function$;

revoke all on function private.process_approval(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.process_approval(uuid, text, text, uuid)
  to authenticated, service_role;

-- Backfill reservations that became due after today's cron already ran. The
-- function is row-locked and status-gated, so this cannot duplicate a loan.
select public.activate_due_borrow_requests(
  (now() at time zone 'Asia/Shanghai')::date
);

notify pgrst, 'reload schema';
