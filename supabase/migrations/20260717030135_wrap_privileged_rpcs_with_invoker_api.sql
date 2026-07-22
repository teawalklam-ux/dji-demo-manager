-- Production migration history: 20260717030135_wrap_privileged_rpcs_with_invoker_api.
-- Keep privileged implementations outside the exposed Data API schema while
-- preserving the exact public RPC names, arguments, defaults, and result types.
-- Each private implementation retains its existing auth.uid()/role checks.

alter function public.check_borrow_availability(uuid[], date, date, uuid) set schema private;
alter function public.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) set schema private;
alter function public.get_borrowable_item_status_details() set schema private;
alter function public.get_current_approval_progress(uuid) set schema private;
alter function public.get_reserved_item_ids() set schema private;
alter function public.process_approval(uuid, text, text, uuid) set schema private;
alter function public.process_return(uuid, text, timestamp with time zone, double precision, double precision, text, text) set schema private;
alter function public.revoke_approval(uuid, text) set schema private;

alter function private.check_borrow_availability(uuid[], date, date, uuid) set search_path = '';
alter function private.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) set search_path = '';
alter function private.get_borrowable_item_status_details() set search_path = '';
alter function private.get_current_approval_progress(uuid) set search_path = '';
alter function private.get_reserved_item_ids() set search_path = '';
alter function private.process_approval(uuid, text, text, uuid) set search_path = '';
alter function private.process_return(uuid, text, timestamp with time zone, double precision, double precision, text, text) set search_path = '';
alter function private.revoke_approval(uuid, text) set search_path = '';

revoke all on function private.check_borrow_availability(uuid[], date, date, uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.get_borrowable_item_status_details() from public, anon, authenticated, service_role;
revoke all on function private.get_current_approval_progress(uuid) from public, anon, authenticated, service_role;
revoke all on function private.get_reserved_item_ids() from public, anon, authenticated, service_role;
revoke all on function private.process_approval(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.process_return(uuid, text, timestamp with time zone, double precision, double precision, text, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_approval(uuid, text) from public, anon, authenticated, service_role;

grant execute on function private.check_borrow_availability(uuid[], date, date, uuid) to authenticated, service_role;
grant execute on function private.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) to authenticated, service_role;
grant execute on function private.get_borrowable_item_status_details() to authenticated, service_role;
grant execute on function private.get_current_approval_progress(uuid) to authenticated, service_role;
grant execute on function private.get_reserved_item_ids() to authenticated, service_role;
grant execute on function private.process_approval(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function private.process_return(uuid, text, timestamp with time zone, double precision, double precision, text, text) to authenticated, service_role;
grant execute on function private.revoke_approval(uuid, text) to authenticated, service_role;

create function public.check_borrow_availability(
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
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.check_borrow_availability(
    p_item_ids,
    p_expected_borrow_date,
    p_expected_return_date,
    p_exclude_request_id
  );
$$;

create function public.create_borrow_request(
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
language sql
security invoker
set search_path = ''
as $$
  select private.create_borrow_request(
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
$$;

create function public.get_borrowable_item_status_details()
returns table(
  item_id uuid,
  display_status text,
  reserved_start_date date,
  reserved_end_date date,
  due_date date,
  serial_number_last4 text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_borrowable_item_status_details();
$$;

create function public.get_current_approval_progress(p_request_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_current_approval_progress(p_request_id);
$$;

create function public.get_reserved_item_ids()
returns table(item_id uuid)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_reserved_item_ids();
$$;

create function public.process_approval(
  p_request_id uuid,
  p_action text,
  p_comment text default null,
  p_approver_id uuid default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.process_approval(
    p_request_id,
    p_action,
    p_comment,
    p_approver_id
  );
$$;

create function public.process_return(
  p_borrow_record_id uuid,
  p_photo_storage_path text default null,
  p_photo_captured_at timestamp with time zone default null,
  p_photo_latitude double precision default null,
  p_photo_longitude double precision default null,
  p_photo_address text default null,
  p_notes text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.process_return(
    p_borrow_record_id,
    p_photo_storage_path,
    p_photo_captured_at,
    p_photo_latitude,
    p_photo_longitude,
    p_photo_address,
    p_notes
  );
$$;

create function public.revoke_approval(
  p_request_id uuid,
  p_reason text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.revoke_approval(p_request_id, p_reason);
$$;

revoke all on function public.check_borrow_availability(uuid[], date, date, uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_borrowable_item_status_details() from public, anon, authenticated, service_role;
revoke all on function public.get_current_approval_progress(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_reserved_item_ids() from public, anon, authenticated, service_role;
revoke all on function public.process_approval(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.process_return(uuid, text, timestamp with time zone, double precision, double precision, text, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_approval(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.check_borrow_availability(uuid[], date, date, uuid) to authenticated, service_role;
grant execute on function public.create_borrow_request(uuid, uuid[], text, text, date, date, text, text, uuid) to authenticated, service_role;
grant execute on function public.get_borrowable_item_status_details() to authenticated, service_role;
grant execute on function public.get_current_approval_progress(uuid) to authenticated, service_role;
grant execute on function public.get_reserved_item_ids() to authenticated, service_role;
grant execute on function public.process_approval(uuid, text, text, uuid) to authenticated, service_role;
grant execute on function public.process_return(uuid, text, timestamp with time zone, double precision, double precision, text, text) to authenticated, service_role;
grant execute on function public.revoke_approval(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
