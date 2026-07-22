-- Production migration history: 20260717024731_harden_function_grants_and_rls.
-- P0 security hardening:
-- 1. Keep the role lookup helper usable by RLS without exposing it as a public RPC.
-- 2. Remove direct API execution from trigger and maintenance functions.
-- 3. Replace public-role policies with explicit anon/authenticated policies.

-- Move the RLS helper out of the exposed public schema. PostgreSQL keeps policy
-- dependencies attached to the function OID when the function changes schema.
alter function public.get_current_user_role() set schema private;
alter function private.get_current_user_role() set search_path = '';

revoke all on function private.get_current_user_role() from public, anon, authenticated, service_role;
grant usage on schema private to anon, authenticated;
grant execute on function private.get_current_user_role() to anon, authenticated;

-- These private administration helpers referenced the helper by its old schema.
-- IS DISTINCT FROM denies callers whose auth context has no profile/role.
create or replace function private.approve_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.get_current_user_role()) is distinct from 'admin' then
    raise exception '仅管理员可审批用户' using errcode = '42501';
  end if;

  update public.profiles
  set status = 'active', updated_at = now()
  where id = p_user_id and status = 'pending_approval';
end;
$$;

create or replace function private.reject_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.get_current_user_role()) is distinct from 'admin' then
    raise exception '仅管理员可拒绝用户' using errcode = '42501';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function private.approve_user(uuid) from public, anon, authenticated, service_role;
revoke all on function private.reject_user(uuid) from public, anon, authenticated, service_role;

-- Trigger/event-trigger functions execute through their trigger owners; browser
-- roles do not need direct EXECUTE privileges on them.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_request_status_changed() from public, anon, authenticated;
revoke all on function public.on_borrow_returned() from public, anon, authenticated;
revoke all on function public.on_request_approved() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- This maintenance function changes borrow, item, and request statuses. It is not
-- called by the frontend and must only be callable from a trusted backend role.
revoke all on function public.check_overdue_status() from public, anon, authenticated;
grant execute on function public.check_overdue_status() to service_role;

-- Defense in depth: sensitive tables are no longer granted to the anonymous role.
revoke all privileges on table public.approval_chains from anon;
revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.user_customers from anon;
revoke all privileges on table public.categories from anon;
grant select on table public.categories to anon;

-- Approval chains: signed-in users can read active chains, while admins retain
-- management access and visibility of inactive chains.
drop policy if exists "所有登录用户可查看审批链" on public.approval_chains;
drop policy if exists "管理员可管理审批链" on public.approval_chains;

create policy "所有登录用户可查看审批链"
on public.approval_chains
for select
to authenticated
using (
  is_active = true
  or (select private.get_current_user_role()) in ('admin', 'super_admin')
);

create policy "管理员可新增审批链"
on public.approval_chains
for insert
to authenticated
with check ((select private.get_current_user_role()) in ('admin', 'super_admin'));

create policy "管理员可更新审批链"
on public.approval_chains
for update
to authenticated
using ((select private.get_current_user_role()) in ('admin', 'super_admin'))
with check ((select private.get_current_user_role()) in ('admin', 'super_admin'));

create policy "管理员可删除审批链"
on public.approval_chains
for delete
to authenticated
using ((select private.get_current_user_role()) in ('admin', 'super_admin'));

-- Categories intentionally keep anonymous read access to active rows only.
-- Admin management is split by operation so it no longer overlaps SELECT.
drop policy if exists "所有人可查看活跃分类" on public.categories;
drop policy if exists "管理员可管理分类" on public.categories;

create policy "所有人可查看活跃分类"
on public.categories
for select
to anon, authenticated
using (
  is_active = true
  or (select private.get_current_user_role()) in ('admin', 'super_admin')
);

create policy "管理员可新增分类"
on public.categories
for insert
to authenticated
with check ((select private.get_current_user_role()) in ('admin', 'super_admin'));

create policy "管理员可更新分类"
on public.categories
for update
to authenticated
using ((select private.get_current_user_role()) in ('admin', 'super_admin'))
with check ((select private.get_current_user_role()) in ('admin', 'super_admin'));

create policy "管理员可删除分类"
on public.categories
for delete
to authenticated
using ((select private.get_current_user_role()) in ('admin', 'super_admin'));

-- Profiles are no longer anonymously readable. Consolidating the permissive
-- policies preserves the previous OR semantics for signed-in users.
drop policy if exists "可查看活跃用户" on public.profiles;
drop policy if exists "用户可查看自己的资料" on public.profiles;
drop policy if exists "管理员可查看所有用户" on public.profiles;
drop policy if exists "用户可更新自己的资料" on public.profiles;
drop policy if exists "管理员可更新任何用户" on public.profiles;
drop policy if exists "管理员可插入用户" on public.profiles;

create policy "登录用户可查看允许的用户资料"
on public.profiles
for select
to authenticated
using (
  status = 'active'
  or id = (select auth.uid())
  or (select private.get_current_user_role()) in ('admin', 'super_admin')
);

create policy "管理员可插入用户"
on public.profiles
for insert
to authenticated
with check ((select private.get_current_user_role()) in ('admin', 'super_admin'));

create policy "用户或管理员可更新用户资料"
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  or (select private.get_current_user_role()) = 'super_admin'
  or (
    (select private.get_current_user_role()) = 'admin'
    and role <> 'super_admin'
  )
)
with check (
  (
    id = (select auth.uid())
    and role = (select private.get_current_user_role())
  )
  or (select private.get_current_user_role()) = 'super_admin'
  or (
    (select private.get_current_user_role()) = 'admin'
    and role <> 'super_admin'
  )
);

-- Customer data is authenticated-only. Merge the two SELECT policies and scope
-- the remaining owner policies to authenticated explicitly.
drop policy if exists "用户可查看自己的客户" on public.user_customers;
drop policy if exists "超级管理员可查看所有客户" on public.user_customers;

create policy "用户或超级管理员可查看客户"
on public.user_customers
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.get_current_user_role()) = 'super_admin'
);

alter policy "用户可添加自己的客户"
on public.user_customers
to authenticated;

alter policy "用户可修改自己的客户"
on public.user_customers
to authenticated;

alter policy "用户可删除自己的客户"
on public.user_customers
to authenticated;

notify pgrst, 'reload schema';
