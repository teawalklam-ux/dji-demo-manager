-- Persist editable SOP guides while keeping read visibility aligned with the
-- existing user/admin/super-admin hierarchy.

create table public.sop_processes (
  id text primary key,
  kind text not null check (kind in ('operations', 'system')),
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 240),
  status text not null default 'draft' check (status in ('ready', 'draft')),
  icon_key text not null default 'book-open-check' check (char_length(icon_key) between 1 and 64),
  required_role text check (required_role in ('user', 'approver', 'admin', 'super_admin')),
  role_group text check (role_group in ('user', 'admin', 'super_admin')),
  entry_href text check (entry_href is null or char_length(entry_href) <= 500),
  entry_label text check (entry_label is null or char_length(entry_label) <= 80),
  stages jsonb not null default '{"materials":[],"workflow":[],"followup":[]}'::jsonb,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sop_processes_role_shape_check check (
    (kind = 'operations' and required_role is null and role_group is null)
    or
    (
      kind = 'system'
      and required_role is not null
      and role_group is not null
      and (
        (required_role = 'user' and role_group = 'user')
        or (required_role in ('approver', 'admin') and role_group = 'admin')
        or (required_role = 'super_admin' and role_group = 'super_admin')
      )
    )
  ),
  constraint sop_processes_stages_shape_check check (
    jsonb_typeof(stages) = 'object'
    and stages ?& array['materials', 'workflow', 'followup']
    and jsonb_typeof(stages -> 'materials') = 'array'
    and jsonb_typeof(stages -> 'workflow') = 'array'
    and jsonb_typeof(stages -> 'followup') = 'array'
  )
);

create index sop_processes_sort_order_idx
on public.sop_processes (sort_order, id);

create index sop_processes_created_by_idx
on public.sop_processes (created_by);

create index sop_processes_updated_by_idx
on public.sop_processes (updated_by);

create trigger update_sop_processes_updated_at
before update on public.sop_processes
for each row execute function public.update_updated_at();

alter table public.sop_processes enable row level security;

-- New Supabase projects no longer expose public tables automatically. Keep the
-- Data API surface explicit and let RLS decide which rows each user can reach.
revoke all on table public.sop_processes from anon, authenticated;
grant select, insert, update, delete on table public.sop_processes to authenticated;

create policy "有效用户按角色查看SOP"
on public.sop_processes
for select
to authenticated
using (
  (select private.is_current_user_active())
  and (
    kind = 'operations'
    or required_role = 'user'
    or (required_role = 'approver' and (select private.get_current_user_role()) in ('approver', 'admin', 'super_admin'))
    or (required_role = 'admin' and (select private.get_current_user_role()) in ('admin', 'super_admin'))
    or (required_role = 'super_admin' and (select private.get_current_user_role()) = 'super_admin')
  )
);

-- Admins manage only rows within their own visibility boundary. Super admins
-- manage the full catalog.
create policy "管理员可新增SOP"
on public.sop_processes
for insert
to authenticated
with check (
  (
    (select private.get_current_user_role()) = 'super_admin'
    or (
      (select private.get_current_user_role()) = 'admin'
      and required_role is distinct from 'super_admin'
    )
  )
  and updated_by = (select auth.uid())
  and created_by = (select auth.uid())
);

create policy "管理员可更新可见SOP"
on public.sop_processes
for update
to authenticated
using (
  (select private.get_current_user_role()) = 'super_admin'
  or (
    (select private.get_current_user_role()) = 'admin'
    and required_role is distinct from 'super_admin'
  )
)
with check (
  updated_by = (select auth.uid())
  and (
    (select private.get_current_user_role()) = 'super_admin'
    or (
      (select private.get_current_user_role()) = 'admin'
      and required_role is distinct from 'super_admin'
    )
  )
);

create policy "管理员可删除可见SOP"
on public.sop_processes
for delete
to authenticated
using (
  (select private.get_current_user_role()) = 'super_admin'
  or (
    (select private.get_current_user_role()) = 'admin'
    and required_role is distinct from 'super_admin'
  )
);

create or replace function public.replace_sop_processes(p_processes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_role text := (select private.get_current_user_role());
begin
  if caller_role not in ('admin', 'super_admin') then
    raise exception '仅管理员可保存 SOP' using errcode = '42501';
  end if;

  if jsonb_typeof(p_processes) is distinct from 'array' then
    raise exception 'SOP 保存数据必须是数组' using errcode = '22023';
  end if;

  if jsonb_array_length(p_processes) > 100 then
    raise exception '单次最多保存 100 条 SOP' using errcode = '22023';
  end if;

  -- RLS intentionally preserves rows above an administrator's visibility level.
  delete from public.sop_processes;

  insert into public.sop_processes (
    id,
    kind,
    title,
    description,
    status,
    icon_key,
    required_role,
    role_group,
    entry_href,
    entry_label,
    stages,
    sort_order,
    created_by,
    updated_by
  )
  select
    record.id,
    record.kind,
    record.title,
    coalesce(record.description, ''),
    coalesce(record.status, 'draft'),
    coalesce(record.icon_key, 'book-open-check'),
    record.required_role,
    record.role_group,
    nullif(record.entry_href, ''),
    nullif(record.entry_label, ''),
    record.stages,
    coalesce(record.sort_order, 0),
    (select auth.uid()),
    (select auth.uid())
  from jsonb_to_recordset(p_processes) as record(
    id text,
    kind text,
    title text,
    description text,
    status text,
    icon_key text,
    required_role text,
    role_group text,
    entry_href text,
    entry_label text,
    stages jsonb,
    sort_order integer
  )
  where caller_role = 'super_admin'
    or record.required_role is distinct from 'super_admin'
  on conflict (id) do update
  set
    kind = excluded.kind,
    title = excluded.title,
    description = excluded.description,
    status = excluded.status,
    icon_key = excluded.icon_key,
    required_role = excluded.required_role,
    role_group = excluded.role_group,
    entry_href = excluded.entry_href,
    entry_label = excluded.entry_label,
    stages = excluded.stages,
    sort_order = excluded.sort_order,
    updated_by = excluded.updated_by
  where caller_role = 'super_admin'
    or excluded.required_role is distinct from 'super_admin';

end;
$$;

revoke all on function public.replace_sop_processes(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.replace_sop_processes(jsonb) to authenticated;

comment on table public.sop_processes is
  'Editable business and system SOP guides. RLS filters system guides by the existing role hierarchy.';

comment on function public.replace_sop_processes(jsonb) is
  'Atomically replaces every SOP row visible to the current administrator; higher-privilege rows remain untouched.';
