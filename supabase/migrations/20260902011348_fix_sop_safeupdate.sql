-- Keep the atomic SOP replacement compatible with Supabase's `safeupdate`
-- preload while preserving the existing administrator visibility boundary.
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

  delete from public.sop_processes
  where caller_role = 'super_admin'
    or required_role is distinct from 'super_admin';

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

comment on function public.replace_sop_processes(jsonb) is
  'Atomically replaces SOP rows within the current administrator visibility boundary; the explicit delete predicate is required by safeupdate.';
