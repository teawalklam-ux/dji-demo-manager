-- Harden legacy trigger/maintenance functions without replacing them, so their
-- OIDs, trigger dependencies, ownership, and existing intentional grants remain
-- stable.

-- PostgreSQL's built-in PUBLIC EXECUTE default is global. A schema-scoped REVOKE
-- cannot negate it, so remove the global default first. Then remove any explicit
-- public-schema grants for API roles, including service_role. Migrations must
-- grant EXECUTE explicitly to each intended caller.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- All referenced relations and sequences in these functions are schema-qualified.
-- pg_catalog remains implicitly searchable when search_path is empty.
alter function public.generate_barcode() set search_path = '';
alter function public.generate_request_number() set search_path = '';
alter function public.update_updated_at() set search_path = '';
alter function public.check_overdue_status() set search_path = '';
alter function public.handle_request_status_changed() set search_path = '';

-- These two legacy no-op trigger functions already had a fixed path, but using
-- public in a SECURITY DEFINER search path is unnecessary and avoidable.
alter function public.on_borrow_returned() set search_path = '';
alter function public.on_request_approved() set search_path = '';

-- Trigger functions are invoked by their triggers and are not browser RPCs.
revoke all on function public.generate_barcode()
from public, anon, authenticated, service_role;

revoke all on function public.generate_request_number()
from public, anon, authenticated, service_role;

revoke all on function public.update_updated_at()
from public, anon, authenticated, service_role;

revoke all on function public.handle_request_status_changed()
from public, anon, authenticated, service_role;

revoke all on function public.on_borrow_returned()
from public, anon, authenticated, service_role;

revoke all on function public.on_request_approved()
from public, anon, authenticated, service_role;

-- This maintenance RPC is intentionally reserved for the trusted backend role.
revoke all on function public.check_overdue_status()
from public, anon, authenticated;
grant execute on function public.check_overdue_status() to service_role;
