-- Finalize the profile update boundary after the frontend has switched to
-- public.manage_user_profile().

drop policy if exists "管理员可插入用户" on public.profiles;

drop policy if exists "用户或管理员可更新用户资料" on public.profiles;
create policy "用户可更新自己的安全资料字段"
on public.profiles
for update
to authenticated
using (
  id = (select auth.uid())
  and (select private.is_current_user_active())
)
with check (
  id = (select auth.uid())
  and status = 'active'
  and is_active = true
  and role = (select private.get_current_user_role())
);

revoke insert, update, delete, truncate, references, trigger
on table public.profiles
from authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, phone, department, avatar_url)
on table public.profiles
to authenticated;

-- Remove privileges that the browser application never needs and that are not
-- governed by row-level security (notably TRUNCATE).
revoke truncate, references, trigger
on table
  public.approval_chains,
  public.approval_records,
  public.borrow_records,
  public.borrow_request_items,
  public.borrow_requests,
  public.categories,
  public.items,
  public.overdue_notifications,
  public.return_photos,
  public.stock_movements,
  public.user_customers
from authenticated;
