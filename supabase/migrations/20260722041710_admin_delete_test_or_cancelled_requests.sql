-- v1.51: allow active administrators to delete only test requests or requests
-- cancelled by their requester. All relational cleanup runs in one transaction.

create table if not exists public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null default 'return-photos',
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.storage_cleanup_queue enable row level security;

revoke all on table public.storage_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_cleanup_queue to service_role;

create or replace function private.delete_eligible_borrow_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_role text;
  v_actor_status text;
  v_request_number text;
  v_borrow_type text;
  v_request_status text;
  v_record_ids uuid[] := array[]::uuid[];
  v_approval_count integer := 0;
  v_borrow_record_count integer := 0;
  v_notification_count integer := 0;
  v_movement_count integer := 0;
  v_photo_count integer := 0;
  v_restored_item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception '未登录' using errcode = '42501';
  end if;

  select profile.role, profile.status
    into v_actor_role, v_actor_status
  from public.profiles as profile
  where profile.id = auth.uid();

  if v_actor_status is distinct from 'active'
     or v_actor_role not in ('admin', 'super_admin') then
    raise exception '仅管理员和超级管理员可删除记录' using errcode = '42501';
  end if;

  select request.request_number, request.borrow_type, request.status
    into v_request_number, v_borrow_type, v_request_status
  from public.borrow_requests as request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception '借用申请不存在' using errcode = 'P0002';
  end if;

  if v_borrow_type <> '测试' and v_request_status <> 'cancelled' then
    raise exception '仅可删除借用类型为“测试”或由用户取消的申请' using errcode = '42501';
  end if;

  select coalesce(array_agg(record.id), array[]::uuid[]), count(*)::integer
    into v_record_ids, v_borrow_record_count
  from public.borrow_records as record
  where record.request_id = p_request_id;

  select count(*)::integer
    into v_approval_count
  from public.approval_records as approval
  where approval.request_id = p_request_id;

  select count(*)::integer
    into v_photo_count
  from public.return_photos as photo
  where photo.borrow_record_id = any(v_record_ids);

  insert into public.storage_cleanup_queue (bucket_id, storage_path)
  select 'return-photos', photo.storage_path
  from public.return_photos as photo
  where photo.borrow_record_id = any(v_record_ids)
    and photo.photo_deleted_at is null
  on conflict (storage_path) do nothing;

  -- A deleted active test loan must release its physical item. Do not overwrite
  -- an item that is still held by another active record.
  with affected_items as (
    select distinct record.item_id
    from public.borrow_records as record
    where record.request_id = p_request_id
      and record.status in ('active', 'overdue')
  )
  update public.items as item
  set status = 'in_stock',
      current_borrower_id = null,
      updated_at = now()
  from affected_items
  where item.id = affected_items.item_id
    and not exists (
      select 1
      from public.borrow_records as other_record
      where other_record.item_id = item.id
        and other_record.request_id <> p_request_id
        and other_record.status in ('active', 'overdue')
    );
  get diagnostics v_restored_item_count = row_count;

  delete from public.overdue_notifications as notification
  where notification.borrow_request_id = p_request_id
     or notification.borrow_record_id = any(v_record_ids);
  get diagnostics v_notification_count = row_count;

  delete from public.stock_movements as movement
  where movement.borrow_record_id = any(v_record_ids);
  get diagnostics v_movement_count = row_count;

  delete from public.borrow_records as record
  where record.request_id = p_request_id;

  -- Preserve any renewal request that points at the deleted request.
  update public.borrow_requests as child_request
  set parent_request_id = null,
      updated_at = now()
  where child_request.parent_request_id = p_request_id;

  -- approval_records and borrow_request_items use ON DELETE CASCADE.
  delete from public.borrow_requests as request
  where request.id = p_request_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'request_number', v_request_number,
    'deletion_reason', case
      when v_borrow_type = '测试' and v_request_status = 'cancelled' then 'test_and_cancelled'
      when v_borrow_type = '测试' then 'test'
      else 'cancelled'
    end,
    'deleted_approval_count', v_approval_count,
    'deleted_borrow_record_count', v_borrow_record_count,
    'deleted_notification_count', v_notification_count,
    'deleted_movement_count', v_movement_count,
    'queued_photo_count', v_photo_count,
    'restored_item_count', v_restored_item_count
  );
end;
$function$;

create or replace function public.delete_eligible_borrow_request(
  p_request_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $function$
  select private.delete_eligible_borrow_request(p_request_id);
$function$;

revoke all on function private.delete_eligible_borrow_request(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_eligible_borrow_request(uuid)
  from public, anon, authenticated, service_role;

-- The private schema is not exposed through the Data API. This grant only lets
-- the authenticated public wrapper enter the checked implementation.
grant execute on function private.delete_eligible_borrow_request(uuid)
  to authenticated, service_role;
grant execute on function public.delete_eligible_borrow_request(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
