-- NAS archive search is an operational capability reserved for the active
-- super administrator. Keep ordinary return-photo viewing on its existing
-- per-request RLS path so users can still review photos from their own
-- application details after the Supabase Storage copy is archived.
create or replace function public.can_search_nas_archives()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'super_admin'
      and profile.status = 'active'
  );
$function$;

revoke all on function public.can_search_nas_archives()
  from public, anon, authenticated, service_role;
grant execute on function public.can_search_nas_archives()
  to authenticated;

comment on function public.can_search_nas_archives() is
  'Returns true only for the active super administrator. Used by the LAN NAS search gateway; it does not change return_photos RLS.';
