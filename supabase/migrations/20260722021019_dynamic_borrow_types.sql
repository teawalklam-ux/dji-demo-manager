-- Allow administrators to create a dedicated borrow type together with an
-- approval chain. Custom type names are stored directly so historical records,
-- notifications, and exports retain the human-readable value.

alter table public.borrow_requests
  drop constraint if exists borrow_requests_borrow_type_check;

alter table public.borrow_requests
  add constraint borrow_requests_borrow_type_check
  check (
    borrow_type = btrim(borrow_type)
    and char_length(borrow_type) between 1 and 50
    and borrow_type <> 'all'
  );

alter table public.borrow_records
  drop constraint if exists borrow_records_borrow_type_check;

alter table public.borrow_records
  add constraint borrow_records_borrow_type_check
  check (
    borrow_type = btrim(borrow_type)
    and char_length(borrow_type) between 1 and 50
    and borrow_type <> 'all'
  );

alter table public.approval_chains
  drop constraint if exists approval_chains_borrow_type_check;

alter table public.approval_chains
  add constraint approval_chains_borrow_type_check
  check (
    borrow_type = btrim(borrow_type)
    and char_length(borrow_type) between 1 and 50
  );

comment on column public.approval_chains.borrow_type is
  '借用类型标识；customer、marketing 为内置类型，all 为兜底流程，其他值为管理员创建的自定义类型';

-- The public invoker wrapper delegates to this function. Replacing the private
-- implementation keeps the existing API while validating dynamic types and
-- making an exact type match take priority over the all-type fallback.
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
as $$
declare
  v_request_id uuid;
  v_chain_id uuid;
  v_chain_steps jsonb;
  v_step jsonb;
  v_approver_id uuid;
  v_first_approver_id uuid;
  v_first_step_level int := 2147483647;
begin
  if auth.uid() is null or p_requester_id <> auth.uid() then
    raise exception '无权创建该申请' using errcode = '42501';
  end if;

  if p_borrow_type is null
     or p_borrow_type <> btrim(p_borrow_type)
     or char_length(p_borrow_type) not between 1 and 50
     or p_borrow_type = 'all' then
    raise exception '借用类型无效';
  end if;

  -- Built-in types preserve their legacy fallback behavior. A custom type must
  -- always have its own active chain so a stale or forged value cannot bypass
  -- approval and become approved immediately.
  if p_borrow_type not in ('customer', 'marketing')
     and not exists (
       select 1
       from public.approval_chains
       where borrow_type = p_borrow_type and is_active = true
     ) then
    raise exception '借用类型不存在或对应审批链已停用';
  end if;

  if p_item_ids is null or cardinality(p_item_ids) = 0
     or cardinality(p_item_ids) <> cardinality(array(select distinct id from unnest(p_item_ids) as id)) then
    raise exception '请至少选择一台不同的样机';
  end if;

  if p_expected_borrow_date < (now() at time zone 'Asia/Shanghai')::date
     or p_expected_return_date < p_expected_borrow_date then
    raise exception '借用日期无效';
  end if;

  if exists (
    select 1
    from public.items
    where id = any(p_item_ids) and status in ('maintenance', 'retired')
  ) or (
    select count(*) from public.items where id = any(p_item_ids)
  ) <> cardinality(p_item_ids) then
    raise exception '所选样机不存在、维修中或已退役';
  end if;

  insert into public.borrow_requests (
    requester_id, item_id, borrow_type, purpose, customer_name, customer_contact,
    expected_borrow_date, expected_return_date, parent_request_id, status
  ) values (
    p_requester_id, p_item_ids[1], p_borrow_type, p_purpose, p_customer_name, p_customer_contact,
    p_expected_borrow_date, p_expected_return_date, p_parent_request_id,
    case when p_parent_request_id is null then 'pending' else 'renewal_requested' end
  ) returning id into v_request_id;

  insert into public.borrow_request_items (request_id, item_id)
  select v_request_id, id from unnest(p_item_ids) as id;

  select id, steps into v_chain_id, v_chain_steps
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
    values (v_request_id, v_chain_id, v_approver_id, (v_step ->> 'level')::int);

    if v_approver_id is not null and (v_step ->> 'level')::int < v_first_step_level then
      v_first_approver_id := v_approver_id;
      v_first_step_level := (v_step ->> 'level')::int;
    end if;
  end loop;

  if v_first_approver_id is not null then
    insert into public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type, notification_category,
      recipient_id, borrow_request_id, message, is_read
    ) values (
      null, p_requester_id, 'push', 'approval', v_first_approver_id, v_request_id,
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
$$;

revoke all on function private.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid)
  from public, anon;
grant execute on function private.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid)
  to authenticated, service_role;
