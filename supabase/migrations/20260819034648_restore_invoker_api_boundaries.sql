-- Keep privileged implementations in the unexposed private schema while the
-- public Data API surface remains SECURITY INVOKER. The public wrappers perform
-- the active-account guard before entering the private implementation.

alter function public.check_borrow_availability(uuid[], date, date, uuid)
  security invoker;
alter function public.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid)
  security invoker;
alter function public.delete_eligible_borrow_request(uuid)
  security invoker;
alter function public.get_borrowable_item_status_details()
  security invoker;
alter function public.get_current_approval_progress(uuid)
  security invoker;
alter function public.get_reserved_item_ids()
  security invoker;
alter function public.process_approval(uuid, text, text, uuid)
  security invoker;
alter function public.process_return(uuid, text, timestamptz, double precision, double precision, text, text)
  security invoker;
alter function public.revoke_approval(uuid, text)
  security invoker;
alter function public.update_borrow_request(uuid, uuid[], text, text, date, date, text, text)
  security invoker;

grant execute on function private.require_current_user_active() to authenticated;
grant execute on function private.check_borrow_availability(uuid[], date, date, uuid) to authenticated;
grant execute on function private.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) to authenticated;
grant execute on function private.delete_eligible_borrow_request(uuid) to authenticated;
grant execute on function private.get_borrowable_item_status_details() to authenticated;
grant execute on function private.get_current_approval_progress(uuid) to authenticated;
grant execute on function private.get_reserved_item_ids() to authenticated;
grant execute on function private.process_approval(uuid, text, text, uuid) to authenticated;
grant execute on function private.process_return(uuid, text, timestamptz, double precision, double precision, text, text) to authenticated;
grant execute on function private.revoke_approval(uuid, text) to authenticated;
grant execute on function private.update_borrow_request(uuid, uuid[], text, text, date, date, text, text) to authenticated;

alter function public.manage_user_profile(uuid, jsonb) set schema private;
alter function public.transfer_super_admin(uuid) set schema private;

revoke all on function private.manage_user_profile(uuid, jsonb)
from public, anon, authenticated;
revoke all on function private.transfer_super_admin(uuid)
from public, anon, authenticated;
grant execute on function private.manage_user_profile(uuid, jsonb) to authenticated;
grant execute on function private.transfer_super_admin(uuid) to authenticated;

create or replace function public.manage_user_profile(
  p_user_id uuid,
  p_updates jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  perform private.manage_user_profile(p_user_id, p_updates);
end;
$$;

create or replace function public.transfer_super_admin(
  p_new_super_admin_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.require_current_user_active();
  perform private.transfer_super_admin(p_new_super_admin_id);
end;
$$;

revoke all on function public.manage_user_profile(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.transfer_super_admin(uuid)
from public, anon, authenticated;
grant execute on function public.manage_user_profile(uuid, jsonb) to authenticated;
grant execute on function public.transfer_super_admin(uuid) to authenticated;
