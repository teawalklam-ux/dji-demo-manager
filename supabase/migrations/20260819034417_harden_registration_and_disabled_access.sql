-- Registration and disabled-account authorization hardening.
-- `profiles.status` is the canonical account state. `profiles.is_active` remains
-- as a compatibility column and is kept in sync by a trigger.

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

update public.profiles
set
  is_active = (status = 'active'),
  updated_at = now()
where is_active is distinct from (status = 'active');

create or replace function private.sync_profile_activation_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_active := (new.status = 'active');
  return new;
end;
$$;

revoke all on function private.sync_profile_activation_state()
from public, anon, authenticated;

drop trigger if exists sync_profile_activation_state on public.profiles;
create trigger sync_profile_activation_state
before insert or update of status, is_active on public.profiles
for each row execute function private.sync_profile_activation_state();

alter table public.profiles
  drop constraint if exists profiles_status_matches_is_active;

alter table public.profiles
  add constraint profiles_status_matches_is_active
  check (is_active = (status = 'active'));

-- Auth users created through the public sign-up API can control user_metadata,
-- so authorization data is accepted only from service-controlled app_metadata.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin_invite boolean :=
    coalesce(new.raw_app_meta_data ->> 'dji_invited_by_admin', 'false') = 'true';
  v_initial_role text := new.raw_app_meta_data ->> 'dji_initial_role';
  v_role text := 'user';
  v_status text := 'pending_approval';
begin
  if v_is_admin_invite
     and v_initial_role = any (array['user', 'approver', 'admin']::text[]) then
    v_role := v_initial_role;
    v_status := 'active';
  end if;

  insert into public.profiles (id, display_name, email, role, status)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      new.email,
      '未命名用户'
    ),
    new.email,
    v_role,
    v_status
  );

  return new;
end;
$$;

revoke all on function private.handle_new_user()
from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

drop function if exists public.handle_new_user();

create or replace function private.is_current_user_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = (select auth.uid())
        and profile.status = 'active'
    );
$$;

revoke all on function private.is_current_user_active()
from public, anon, authenticated;
grant execute on function private.is_current_user_active() to authenticated;

create or replace function private.require_current_user_active()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_current_user_active() then
    raise exception '账号未激活或已被禁用' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_current_user_active()
from public, anon, authenticated;

create or replace function private.get_current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.status = 'active';
$$;

revoke all on function private.get_current_user_role()
from public, anon, authenticated;
grant execute on function private.get_current_user_role() to authenticated;

-- Inactive users may read only their own profile. Active users retain the
-- existing profile lookup behavior used by approver selectors.
drop policy if exists "登录用户可查看允许的用户资料" on public.profiles;
create policy "登录用户可查看允许的用户资料"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (
    (select private.is_current_user_active())
    and status = 'active'
  )
  or (select private.get_current_user_role()) in ('admin', 'super_admin')
);

-- Compatibility policy for the currently deployed admin UI. Inactive users
-- can no longer update themselves, and active users cannot change account state.
-- The follow-up migration removes protected-column updates entirely.
drop policy if exists "用户或管理员可更新用户资料" on public.profiles;
create policy "用户或管理员可更新用户资料"
on public.profiles
for update
to authenticated
using (
  (
    id = (select auth.uid())
    and (select private.is_current_user_active())
  )
  or (select private.get_current_user_role()) = 'super_admin'
  or (
    (select private.get_current_user_role()) = 'admin'
    and role <> 'super_admin'
  )
)
with check (
  (
    id = (select auth.uid())
    and status = 'active'
    and is_active = true
    and role = (select private.get_current_user_role())
  )
  or (select private.get_current_user_role()) = 'super_admin'
  or (
    (select private.get_current_user_role()) = 'admin'
    and role <> 'super_admin'
  )
);

-- One explicit API for super-admin user management. Protected fields cannot be
-- changed through generic table updates after the follow-up migration.
create or replace function public.manage_user_profile(
  p_user_id uuid,
  p_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_target_role text;
  v_target_status text;
begin
  if v_caller_id is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as caller
    where caller.id = v_caller_id
      and caller.role = 'super_admin'
      and caller.status = 'active'
  ) then
    raise exception '仅活跃的超级管理员可管理用户' using errcode = '42501';
  end if;

  if p_updates is null
     or jsonb_typeof(p_updates) <> 'object'
     or p_updates = '{}'::jsonb then
    raise exception '没有可更新的用户字段' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_updates) as key_name
    where key_name not in ('display_name', 'phone', 'department', 'role', 'status')
  ) then
    raise exception '包含不允许更新的用户字段' using errcode = '22023';
  end if;

  select target.role, target.status
  into v_target_role, v_target_status
  from public.profiles as target
  where target.id = p_user_id
  for update;

  if not found then
    raise exception '用户不存在' using errcode = 'P0002';
  end if;

  if p_user_id = v_caller_id
     and (p_updates ? 'role' or p_updates ? 'status') then
    raise exception '不能通过普通用户管理修改自己的角色或状态' using errcode = '42501';
  end if;

  if v_target_role = 'super_admin'
     and (p_updates ? 'role' or p_updates ? 'status') then
    raise exception '超级管理员只能通过权限转移流程变更' using errcode = '42501';
  end if;

  if p_updates ? 'display_name' and (
    jsonb_typeof(p_updates -> 'display_name') <> 'string'
    or nullif(btrim(p_updates ->> 'display_name'), '') is null
    or char_length(btrim(p_updates ->> 'display_name')) > 100
  ) then
    raise exception '用户姓名格式无效' using errcode = '22023';
  end if;

  if p_updates ? 'phone'
     and jsonb_typeof(p_updates -> 'phone') not in ('string', 'null') then
    raise exception '手机号格式无效' using errcode = '22023';
  end if;

  if p_updates ? 'phone'
     and jsonb_typeof(p_updates -> 'phone') = 'string'
     and char_length(btrim(p_updates ->> 'phone')) > 50 then
    raise exception '手机号格式无效' using errcode = '22023';
  end if;

  if p_updates ? 'department'
     and jsonb_typeof(p_updates -> 'department') not in ('string', 'null') then
    raise exception '部门格式无效' using errcode = '22023';
  end if;

  if p_updates ? 'department'
     and jsonb_typeof(p_updates -> 'department') = 'string'
     and char_length(btrim(p_updates ->> 'department')) > 100 then
    raise exception '部门格式无效' using errcode = '22023';
  end if;

  if p_updates ? 'role' and (
    jsonb_typeof(p_updates -> 'role') <> 'string'
    or p_updates ->> 'role' not in ('user', 'approver', 'admin')
  ) then
    raise exception '用户角色无效' using errcode = '22023';
  end if;

  if p_updates ? 'status' and (
    jsonb_typeof(p_updates -> 'status') <> 'string'
    or p_updates ->> 'status' not in ('pending_approval', 'active', 'disabled')
  ) then
    raise exception '用户状态无效' using errcode = '22023';
  end if;

  update public.profiles as target
  set
    display_name = case
      when p_updates ? 'display_name' then btrim(p_updates ->> 'display_name')
      else target.display_name
    end,
    phone = case
      when not (p_updates ? 'phone') then target.phone
      when jsonb_typeof(p_updates -> 'phone') = 'null' then null
      else nullif(btrim(p_updates ->> 'phone'), '')
    end,
    department = case
      when not (p_updates ? 'department') then target.department
      when jsonb_typeof(p_updates -> 'department') = 'null' then null
      else nullif(btrim(p_updates ->> 'department'), '')
    end,
    role = case
      when p_updates ? 'role' then p_updates ->> 'role'
      else target.role
    end,
    status = case
      when p_updates ? 'status' then p_updates ->> 'status'
      else target.status
    end,
    updated_at = now()
  where target.id = p_user_id;
end;
$$;

revoke all on function public.manage_user_profile(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.manage_user_profile(uuid, jsonb) to authenticated;

-- Recreate the missing production RPC with an active-user check and atomic
-- locking. This remains the only way to assign the super_admin role.
create or replace function public.transfer_super_admin(
  p_new_super_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_current_super_admin_id uuid;
begin
  perform 1
  from public.profiles
  where role = 'super_admin'
  for update;

  select profile.id
  into v_current_super_admin_id
  from public.profiles as profile
  where profile.role = 'super_admin'
    and profile.status = 'active';

  if v_caller_id is null or v_caller_id <> v_current_super_admin_id then
    raise exception '仅当前活跃的超级管理员可转移权限' using errcode = '42501';
  end if;

  if p_new_super_admin_id = v_caller_id then
    raise exception '目标用户不能是当前超级管理员' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as target
    where target.id = p_new_super_admin_id
      and target.role = 'admin'
      and target.status = 'active'
  ) then
    raise exception '目标用户必须是活跃管理员' using errcode = '22023';
  end if;

  update public.profiles
  set role = 'admin', updated_at = now()
  where id = v_current_super_admin_id;

  update public.profiles
  set role = 'super_admin', updated_at = now()
  where id = p_new_super_admin_id;
end;
$$;

revoke all on function public.transfer_super_admin(uuid)
from public, anon, authenticated;
grant execute on function public.transfer_super_admin(uuid) to authenticated;

-- Every business table requires an active account in addition to its existing
-- ownership/role policies. Restrictive policies are ANDed with permissive ones.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'approval_chains',
    'approval_records',
    'borrow_records',
    'borrow_request_items',
    'borrow_requests',
    'categories',
    'items',
    'overdue_notifications',
    'reservation_events',
    'return_photos',
    'stock_movements',
    'user_customers'
  ]
  loop
    execute format('drop policy if exists active_users_only on public.%I', v_table);
    execute format(
      'create policy active_users_only on public.%I as restrictive for all to authenticated using ((select private.is_current_user_active())) with check ((select private.is_current_user_active()))',
      v_table
    );
  end loop;
end;
$$;

drop policy if exists active_users_only on storage.objects;
create policy active_users_only
on storage.objects
as restrictive
for all
to authenticated
using ((select private.is_current_user_active()))
with check ((select private.is_current_user_active()));

-- Public RPC wrappers validate account state before entering privileged private
-- functions. Direct execution of those private functions is removed.
create or replace function public.check_borrow_availability(
  p_item_ids uuid[],
  p_expected_borrow_date date,
  p_expected_return_date date,
  p_exclude_request_id uuid default null
)
returns table(
  item_id uuid,
  item_name text,
  occupied_start_date date,
  occupied_end_date date,
  occupied_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  return query
  select *
  from private.check_borrow_availability(
    p_item_ids,
    p_expected_borrow_date,
    p_expected_return_date,
    p_exclude_request_id
  );
end;
$$;

create or replace function public.create_borrow_request(
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
begin
  perform private.require_current_user_active();
  return private.create_borrow_request(
    p_requester_id,
    p_item_ids,
    p_borrow_type,
    p_purpose,
    p_expected_borrow_date,
    p_expected_return_date,
    p_customer_name,
    p_customer_contact,
    p_parent_request_id
  );
end;
$$;

create or replace function public.delete_eligible_borrow_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  return private.delete_eligible_borrow_request(p_request_id);
end;
$$;

create or replace function public.get_borrowable_item_status_details()
returns table(
  item_id uuid,
  display_status text,
  reserved_start_date date,
  reserved_end_date date,
  due_date date,
  serial_number_last4 text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  return query select * from private.get_borrowable_item_status_details();
end;
$$;

create or replace function public.get_current_approval_progress(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  return private.get_current_approval_progress(p_request_id);
end;
$$;

create or replace function public.get_reserved_item_ids()
returns table(item_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  return query select * from private.get_reserved_item_ids();
end;
$$;

create or replace function public.process_approval(
  p_request_id uuid,
  p_action text,
  p_comment text default null,
  p_approver_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  return private.process_approval(
    p_request_id,
    p_action,
    p_comment,
    p_approver_id
  );
end;
$$;

create or replace function public.process_return(
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
as $$
begin
  perform private.require_current_user_active();
  perform private.process_return(
    p_borrow_record_id,
    p_photo_storage_path,
    p_photo_captured_at,
    p_photo_latitude,
    p_photo_longitude,
    p_photo_address,
    p_notes
  );
end;
$$;

create or replace function public.revoke_approval(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  perform private.revoke_approval(p_request_id, p_reason);
end;
$$;

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
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  return private.update_borrow_request(
    p_request_id,
    p_item_ids,
    p_borrow_type,
    p_purpose,
    p_expected_borrow_date,
    p_expected_return_date,
    p_customer_name,
    p_customer_contact
  );
end;
$$;

revoke all on function private.check_borrow_availability(uuid[], date, date, uuid)
from public, anon, authenticated;
revoke all on function private.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid)
from public, anon, authenticated;
revoke all on function private.delete_eligible_borrow_request(uuid)
from public, anon, authenticated;
revoke all on function private.get_borrowable_item_status_details()
from public, anon, authenticated;
revoke all on function private.get_current_approval_progress(uuid)
from public, anon, authenticated;
revoke all on function private.get_reserved_item_ids()
from public, anon, authenticated;
revoke all on function private.process_approval(uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function private.process_return(uuid, text, timestamptz, double precision, double precision, text, text)
from public, anon, authenticated;
revoke all on function private.revoke_approval(uuid, text)
from public, anon, authenticated;
revoke all on function private.update_borrow_request(uuid, uuid[], text, text, date, date, text, text)
from public, anon, authenticated;

revoke all on function public.check_borrow_availability(uuid[], date, date, uuid)
from public, anon, authenticated;
revoke all on function public.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.delete_eligible_borrow_request(uuid)
from public, anon, authenticated;
revoke all on function public.get_borrowable_item_status_details()
from public, anon, authenticated;
revoke all on function public.get_current_approval_progress(uuid)
from public, anon, authenticated;
revoke all on function public.get_reserved_item_ids()
from public, anon, authenticated;
revoke all on function public.process_approval(uuid, text, text, uuid)
from public, anon, authenticated;
revoke all on function public.process_return(uuid, text, timestamptz, double precision, double precision, text, text)
from public, anon, authenticated;
revoke all on function public.revoke_approval(uuid, text)
from public, anon, authenticated;
revoke all on function public.update_borrow_request(uuid, uuid[], text, text, date, date, text, text)
from public, anon, authenticated;

grant execute on function public.check_borrow_availability(uuid[], date, date, uuid) to authenticated;
grant execute on function public.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) to authenticated;
grant execute on function public.delete_eligible_borrow_request(uuid) to authenticated;
grant execute on function public.get_borrowable_item_status_details() to authenticated;
grant execute on function public.get_current_approval_progress(uuid) to authenticated;
grant execute on function public.get_reserved_item_ids() to authenticated;
grant execute on function public.process_approval(uuid, text, text, uuid) to authenticated;
grant execute on function public.process_return(uuid, text, timestamptz, double precision, double precision, text, text) to authenticated;
grant execute on function public.revoke_approval(uuid, text) to authenticated;
grant execute on function public.update_borrow_request(uuid, uuid[], text, text, date, date, text, text) to authenticated;
