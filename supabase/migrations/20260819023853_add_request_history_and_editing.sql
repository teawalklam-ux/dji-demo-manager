-- 申请历史读取权限、待审批申请编辑能力。

-- 超级管理员需要和管理员一样查看全部申请；申请人仍只能查看自己的申请。
drop policy if exists "用户可查看自己的申请" on public.borrow_requests;
create policy "用户可查看自己的申请"
  on public.borrow_requests
  for select
  to authenticated
  using (
    requester_id = (select auth.uid())
    or (select private.get_current_user_role()) in ('super_admin', 'admin', 'approver')
  );

-- 普通客户端仅保留“待审批 -> 已取消”的直接更新能力；业务字段统一经受控 RPC 修改。
drop policy if exists "申请人可更新自己的申请" on public.borrow_requests;
create policy "申请人可更新自己的申请"
  on public.borrow_requests
  for update
  to authenticated
  using (
    requester_id = (select auth.uid())
    and status = 'pending'
  )
  with check (
    requester_id = (select auth.uid())
    and status in ('pending', 'cancelled')
  );

revoke update on table public.borrow_requests from authenticated;
grant update (status, updated_at) on table public.borrow_requests to authenticated;

-- 申请人需要能查看自己申请下的归还证据，即使照片由代办人员上传。
drop policy if exists "归还人可查看自己的归还照片" on public.return_photos;
create policy "归还人可查看自己的归还照片"
  on public.return_photos
  for select
  to authenticated
  using (
    uploader_id = (select auth.uid())
    or exists (
      select 1
      from public.borrow_records as record
      join public.borrow_requests as request on request.id = record.request_id
      where record.id = return_photos.borrow_record_id
        and request.requester_id = (select auth.uid())
    )
    or (select private.get_current_user_role()) in ('admin', 'super_admin', 'approver')
  );

drop policy if exists "用户可查看归还照片" on storage.objects;
create policy "用户可查看归还照片"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'return-photos'
    and (
      (select auth.uid())::text = (storage.foldername(name))[1]
      or exists (
        select 1
        from public.borrow_records as record
        join public.borrow_requests as request on request.id = record.request_id
        where record.id::text = (storage.foldername(name))[2]
          and request.requester_id = (select auth.uid())
      )
      or (select private.get_current_user_role()) in ('admin', 'super_admin', 'approver')
    )
  );

create or replace function private.update_borrow_request(
  p_request_id uuid,
  p_item_ids uuid[],
  p_borrow_type text,
  p_purpose text,
  p_expected_borrow_date date,
  p_expected_return_date date,
  p_customer_name text default null,
  p_customer_contact text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.borrow_requests%rowtype;
  v_chain_id uuid;
  v_chain_steps jsonb;
  v_max_borrow_days integer;
  v_step jsonb;
  v_approver_id uuid;
  v_first_approver_id uuid;
  v_first_step_level integer := 2147483647;
  v_unavailable text;
  v_conflicts text;
  i integer;
begin
  if auth.uid() is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select *
  into v_request
  from public.borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception '申请不存在' using errcode = 'P0002';
  end if;

  if v_request.requester_id <> auth.uid() then
    raise exception '无权修改该申请' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_request.requester_id
      and profile.status = 'active'
      and nullif(btrim(profile.phone), '') is not null
  ) then
    raise exception '请先在个人资料中补充可用于企业微信 @ 的手机号';
  end if;

  if v_request.status <> 'pending' then
    raise exception '该申请已进入审批或处理流程，不能再编辑' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.approval_records as approval
    where approval.request_id = p_request_id
      and (approval.action is not null or approval.acted_at is not null)
  ) then
    raise exception '该申请已有审批结果，不能再编辑' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.borrow_records as record
    where record.request_id = p_request_id
  ) then
    raise exception '该申请已生成借用记录，不能再编辑' using errcode = '55000';
  end if;

  if nullif(btrim(p_purpose), '') is null then
    raise exception '请填写借用用途';
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

  if p_borrow_type = 'customer'
     and (
       nullif(btrim(p_customer_name), '') is null
       or nullif(btrim(p_customer_contact), '') is null
     ) then
    raise exception '客户名称和联系方式不能为空';
  end if;

  if p_item_ids is null
     or cardinality(p_item_ids) = 0
     or cardinality(p_item_ids) <> cardinality(
       array(select distinct id from unnest(p_item_ids) as id)
     ) then
    raise exception '请至少选择一台不同的样机';
  end if;

  if p_expected_borrow_date is null
     or p_expected_return_date is null
     or p_expected_borrow_date < (now() at time zone 'Asia/Shanghai')::date
     or p_expected_return_date < p_expected_borrow_date then
    raise exception '借用日期无效';
  end if;

  select chain.id, chain.steps, chain.max_borrow_days
  into v_chain_id, v_chain_steps, v_max_borrow_days
  from public.approval_chains as chain
  where chain.borrow_type in (p_borrow_type, 'all')
    and chain.is_active = true
  order by
    case when chain.borrow_type = p_borrow_type then 0 else 1 end,
    chain.created_at
  limit 1;

  if v_max_borrow_days is not null
     and (p_expected_return_date - p_expected_borrow_date + 1) > v_max_borrow_days then
    raise exception '借用天数超过当前审批链允许的上限（% 天）', v_max_borrow_days;
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
    p_request_id
  ) as conflict;

  if v_conflicts is not null then
    raise exception '以下样机的日期已被占用，无法申请：%', v_conflicts using errcode = '23P01';
  end if;

  update public.borrow_requests
  set
    item_id = p_item_ids[1],
    borrow_type = p_borrow_type,
    purpose = btrim(p_purpose),
    customer_name = case when p_borrow_type = 'customer' then nullif(btrim(p_customer_name), '') else null end,
    customer_contact = case when p_borrow_type = 'customer' then nullif(btrim(p_customer_contact), '') else null end,
    expected_borrow_date = p_expected_borrow_date,
    expected_return_date = p_expected_return_date,
    updated_at = now()
  where id = p_request_id;

  delete from public.borrow_request_items
  where request_id = p_request_id
    and not (item_id = any(p_item_ids));

  insert into public.borrow_request_items (request_id, item_id)
  select p_request_id, id
  from unnest(p_item_ids) as id
  on conflict (request_id, item_id) do nothing;

  -- 所有步骤仍未处理，可以安全地按照最新借用类型重建审批链。
  delete from public.approval_records where request_id = p_request_id;
  delete from public.overdue_notifications
  where borrow_request_id = p_request_id
    and notification_category = 'approval';

  if v_chain_id is null then
    perform public.reserve_borrow_request(p_request_id);
    return p_request_id;
  end if;

  if jsonb_array_length(v_chain_steps) > 0 then
    for i in 0..jsonb_array_length(v_chain_steps) - 1 loop
      v_step := v_chain_steps -> i;
      v_approver_id := null;

      if v_step ->> 'type' = 'person' then
        v_approver_id := (v_step ->> 'user_id')::uuid;
      else
        select profile.id
        into v_approver_id
        from public.profiles as profile
        where profile.role = v_step ->> 'role'
          and profile.is_active = true
        order by profile.created_at
        limit 1;

        if v_approver_id is null then
          select profile.id
          into v_approver_id
          from public.profiles as profile
          where profile.role in ('super_admin', 'admin')
            and profile.is_active = true
          order by
            case profile.role when 'super_admin' then 0 else 1 end,
            profile.created_at
          limit 1;
        end if;
      end if;

      insert into public.approval_records (request_id, chain_id, approver_id, step_level)
      values (p_request_id, v_chain_id, v_approver_id, (v_step ->> 'level')::integer);

      if v_approver_id is not null
         and (v_step ->> 'level')::integer < v_first_step_level then
        v_first_approver_id := v_approver_id;
        v_first_step_level := (v_step ->> 'level')::integer;
      end if;
    end loop;
  end if;

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
      v_request.requester_id,
      'push',
      'approval',
      v_first_approver_id,
      p_request_id,
      format(
        '申请已更新：%s，%s 台样机，借用日期：%s 至 %s',
        p_borrow_type,
        cardinality(p_item_ids),
        p_expected_borrow_date,
        p_expected_return_date
      ),
      false
    );
  end if;

  return p_request_id;
end;
$function$;

revoke all on function private.update_borrow_request(
  uuid, uuid[], text, text, date, date, text, text
) from public, anon, authenticated, service_role;
grant execute on function private.update_borrow_request(
  uuid, uuid[], text, text, date, date, text, text
) to authenticated, service_role;

create or replace function public.update_borrow_request(
  p_request_id uuid,
  p_item_ids uuid[],
  p_borrow_type text,
  p_purpose text,
  p_expected_borrow_date date,
  p_expected_return_date date,
  p_customer_name text default null,
  p_customer_contact text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.update_borrow_request(
    p_request_id,
    p_item_ids,
    p_borrow_type,
    p_purpose,
    p_expected_borrow_date,
    p_expected_return_date,
    p_customer_name,
    p_customer_contact
  );
$function$;

revoke all on function public.update_borrow_request(
  uuid, uuid[], text, text, date, date, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.update_borrow_request(
  uuid, uuid[], text, text, date, date, text, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
