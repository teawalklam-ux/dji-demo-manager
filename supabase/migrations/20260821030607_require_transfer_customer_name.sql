-- Require a customer name for every new transfer request.
--
-- The original four-argument private function remains as an unexposed
-- implementation helper. The new five-argument API validates and persists the
-- customer name before the transaction commits. A deferred constraint trigger
-- protects the invariant for every insert path without rewriting historical
-- transfer requests that predate this field.

drop function if exists public.create_transfer_request(uuid, uuid[], text, date);

revoke all on function private.create_transfer_request(uuid, uuid[], text, date)
from public, anon, authenticated, service_role;

comment on function private.create_transfer_request(uuid, uuid[], text, date) is
  'Internal transfer implementation helper. Call the five-argument API so customer_name is validated and stored.';

create or replace function private.create_transfer_request(
  p_requester_id uuid,
  p_item_ids uuid[],
  p_customer_name text,
  p_purpose text,
  p_expected_return_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request_id uuid;
  v_customer_name text := nullif(btrim(p_customer_name), '');
begin
  if v_customer_name is null then
    raise exception '请填写客户名称';
  end if;

  if char_length(v_customer_name) > 200 then
    raise exception '客户名称不能超过 200 个字符';
  end if;

  v_request_id := private.create_transfer_request(
    p_requester_id,
    p_item_ids,
    p_purpose,
    p_expected_return_date
  );

  update public.borrow_requests
  set customer_name = v_customer_name,
      updated_at = now()
  where id = v_request_id
    and borrow_type = 'transfer';

  if not found then
    raise exception '转借申请创建失败';
  end if;

  return v_request_id;
end;
$function$;

create or replace function public.create_transfer_request(
  p_requester_id uuid,
  p_item_ids uuid[],
  p_customer_name text,
  p_purpose text,
  p_expected_return_date date
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform private.require_current_user_active();
  return private.create_transfer_request(
    p_requester_id,
    p_item_ids,
    p_customer_name,
    p_purpose,
    p_expected_return_date
  );
end;
$function$;

revoke all on function private.create_transfer_request(uuid, uuid[], text, text, date)
from public, anon, authenticated, service_role;
revoke all on function public.create_transfer_request(uuid, uuid[], text, text, date)
from public, anon, authenticated, service_role;

grant execute on function private.create_transfer_request(uuid, uuid[], text, text, date)
to authenticated;
grant execute on function public.create_transfer_request(uuid, uuid[], text, text, date)
to authenticated;

comment on function public.create_transfer_request(uuid, uuid[], text, text, date) is
  'Creates a multi-item transfer request and requires the destination customer name.';

create or replace function private.enforce_transfer_customer_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_borrow_type text;
  v_customer_name text;
begin
  select request.borrow_type, request.customer_name
  into v_borrow_type, v_customer_name
  from public.borrow_requests as request
  where request.id = new.id;

  if v_borrow_type = 'transfer'
     and nullif(btrim(v_customer_name), '') is null then
    raise exception '转借申请必须填写客户名称';
  end if;

  return null;
end;
$function$;

revoke all on function private.enforce_transfer_customer_name()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_transfer_customer_name
on public.borrow_requests;

create constraint trigger enforce_transfer_customer_name
after insert or update of borrow_type, customer_name
on public.borrow_requests
deferrable initially deferred
for each row
execute function private.enforce_transfer_customer_name();

comment on trigger enforce_transfer_customer_name on public.borrow_requests is
  'Requires customer_name for all newly inserted or explicitly edited transfer requests while preserving historical rows.';

comment on column public.borrow_requests.customer_name is
  'Destination customer name. Required for customer and new transfer requests.';
