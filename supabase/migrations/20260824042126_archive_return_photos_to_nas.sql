-- Archive return watermark photos to a LAN-only NAS before removing the
-- Supabase Storage copy.  The archive/control tables are service-only; the
-- two safe status timestamps and the LAN gateway URL remain readable through
-- the existing authenticated return-photo detail flow.

alter table public.return_photos
  add column if not exists nas_archived_at timestamptz,
  add column if not exists supabase_deleted_at timestamptz;

comment on column public.return_photos.nas_archived_at is
  'Timestamp at which the NAS agent and server-side source hash verification both succeeded.';
comment on column public.return_photos.supabase_deleted_at is
  'Timestamp at which the verified NAS archive replaced the Supabase Storage copy. Metadata remains permanent.';

-- The historical policies treated every approver as a global photo reader.
-- Keep approver access scoped to requests where that user has an actual
-- approval record; admins retain global operational access.
create index if not exists approval_records_request_approver_idx
  on public.approval_records (request_id, approver_id)
  where approver_id is not null;

drop policy if exists "归还人可查看自己的归还照片" on public.return_photos;
create policy "归还人可查看自己的归还照片"
  on public.return_photos
  for select
  to authenticated
  using (
    uploader_id = (select auth.uid())
    or exists (
      select 1
      from public.borrow_records as record
      join public.borrow_requests as request on request.id = record.request_id
      where record.id = return_photos.borrow_record_id
        and request.requester_id = (select auth.uid())
    )
    or (select private.get_current_user_role()) in ('admin', 'super_admin')
    or exists (
      select 1
      from public.borrow_records as record
      join public.approval_records as approval on approval.request_id = record.request_id
      where record.id = return_photos.borrow_record_id
        and approval.approver_id = (select auth.uid())
    )
  );

drop policy if exists "用户可查看归还照片" on storage.objects;
create policy "用户可查看归还照片"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'return-photos'
    and (
      (select auth.uid())::text = (storage.foldername(name))[1]
      or exists (
        select 1
        from public.borrow_records as record
        join public.borrow_requests as request on request.id = record.request_id
        where record.id::text = (storage.foldername(name))[2]
          and request.requester_id = (select auth.uid())
      )
      or (select private.get_current_user_role()) in ('admin', 'super_admin')
      or exists (
        select 1
        from public.borrow_records as record
        join public.approval_records as approval on approval.request_id = record.request_id
        where record.id::text = (storage.foldername(name))[2]
          and approval.approver_id = (select auth.uid())
      )
    )
  );

create table if not exists public.return_photo_archive_config (
  id smallint primary key default 1 check (id = 1),
  nas_view_base_url text,
  storage_quota_bytes bigint not null default 1000000000 check (storage_quota_bytes > 0),
  database_quota_bytes bigint not null default 500000000 check (database_quota_bytes > 0),
  warning_ratio numeric(5,4) not null default 0.7000 check (warning_ratio > 0 and warning_ratio < 1),
  cleanup_trigger_ratio numeric(5,4) not null default 0.8000 check (cleanup_trigger_ratio > 0 and cleanup_trigger_ratio <= 1),
  critical_ratio numeric(5,4) not null default 0.9000 check (critical_ratio > 0 and critical_ratio <= 1),
  cleanup_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (warning_ratio < cleanup_trigger_ratio),
  check (cleanup_trigger_ratio < critical_ratio),
  check (nas_view_base_url is null or nas_view_base_url ~ '^https://[^/]+(?::[0-9]+)?(?:/.*)?$'),
  check (not cleanup_enabled or nas_view_base_url is not null)
);

insert into public.return_photo_archive_config (id)
values (1)
on conflict (id) do nothing;

alter table public.return_photo_archive_config enable row level security;
revoke all on table public.return_photo_archive_config from public, anon, authenticated;
grant select on table public.return_photo_archive_config to authenticated;
grant select, insert, update, delete on table public.return_photo_archive_config to service_role;

drop policy if exists "有效用户可读取归还照片归档配置" on public.return_photo_archive_config;
create policy "有效用户可读取归还照片归档配置"
  on public.return_photo_archive_config
  for select
  to authenticated
  using ((select private.is_current_user_active()));

drop policy if exists "服务角色管理归还照片归档配置" on public.return_photo_archive_config;
create policy "服务角色管理归还照片归档配置"
  on public.return_photo_archive_config
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.return_photo_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  return_photo_id uuid not null unique
    references public.return_photos(id) on delete restrict,
  borrow_record_id uuid,
  request_id uuid,
  request_number text,
  item_id uuid,
  item_name text,
  item_model text,
  serial_number_last4 text,
  source_bucket_id text not null default 'return-photos',
  source_storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'leased', 'verified', 'deleting', 'deleted', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  source_size_bytes bigint check (source_size_bytes is null or source_size_bytes >= 0),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  nas_size_bytes bigint check (nas_size_bytes is null or nas_size_bytes >= 0),
  nas_sha256 text check (nas_sha256 is null or nas_sha256 ~ '^[0-9a-f]{64}$'),
  nas_archive_path text,
  verified_at timestamptz,
  cleanup_retry_after timestamptz,
  deleted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint return_photo_archive_jobs_source_path_check check (
    source_bucket_id = 'return-photos'
    and char_length(source_storage_path) between 1 and 1024
    and source_storage_path !~ '(^|/)\.\.(/|$)'
    and source_storage_path !~ '^/'
  ),
  check (
    nas_archive_path is null
    or (
      char_length(nas_archive_path) between 1 and 1024
      and nas_archive_path !~ '(^|/)\.\.(/|$)'
      and nas_archive_path !~ '^/'
    )
  ),
  check ((status <> 'verified' and status <> 'deleting' and status <> 'deleted') or verified_at is not null),
  check (status <> 'deleted' or deleted_at is not null)
);

-- Keep a point-in-time business label snapshot with the archive job. These
-- columns intentionally have no foreign keys: the photo evidence must remain
-- searchable even if a display label is edited later.
alter table public.return_photo_archive_jobs
  add column if not exists borrow_record_id uuid,
  add column if not exists request_id uuid,
  add column if not exists request_number text,
  add column if not exists item_id uuid,
  add column if not exists item_name text,
  add column if not exists item_model text,
  add column if not exists serial_number_last4 text,
  add column if not exists source_bucket_id text not null default 'return-photos',
  add column if not exists source_storage_path text,
  add column if not exists cleanup_retry_after timestamptz;

create index if not exists return_photo_archive_jobs_claim_idx
  on public.return_photo_archive_jobs (next_attempt_at, created_at)
  where status in ('pending', 'leased');
create index if not exists return_photo_archive_jobs_cleanup_idx
  on public.return_photo_archive_jobs (cleanup_retry_after, verified_at)
  where status = 'verified';

alter table public.return_photo_archive_jobs enable row level security;
revoke all on table public.return_photo_archive_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.return_photo_archive_jobs to service_role;

drop policy if exists "服务角色管理归还照片归档任务" on public.return_photo_archive_jobs;
create policy "服务角色管理归还照片归档任务"
  on public.return_photo_archive_jobs
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.return_photo_archive_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in (
      'sync_verified',
      'sync_failed',
      'cleanup_deleted',
      'cleanup_failed',
      'storage_warning',
      'storage_critical',
      'database_warning',
      'database_critical',
      'unlinked_storage_objects'
    )
  ),
  dedupe_key text unique,
  payload jsonb not null default '{}'::jsonb,
  webhook_status text not null default 'pending'
    check (webhook_status in ('pending', 'delivering', 'delivered', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists return_photo_archive_events_delivery_idx
  on public.return_photo_archive_events (next_attempt_at, created_at)
  where webhook_status in ('pending', 'failed');

alter table public.return_photo_archive_events enable row level security;
revoke all on table public.return_photo_archive_events from public, anon, authenticated;
grant select, insert, update, delete on table public.return_photo_archive_events to service_role;

drop policy if exists "服务角色管理归还照片归档事件" on public.return_photo_archive_events;
create policy "服务角色管理归还照片归档事件"
  on public.return_photo_archive_events
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.return_photo_storage_usage_snapshots (
  id bigint generated always as identity primary key,
  total_storage_bytes bigint not null check (total_storage_bytes >= 0),
  return_photo_storage_bytes bigint not null check (return_photo_storage_bytes >= 0),
  database_bytes bigint not null check (database_bytes >= 0),
  pending_archive_count bigint not null check (pending_archive_count >= 0),
  verified_archive_count bigint not null check (verified_archive_count >= 0),
  captured_at timestamptz not null default now()
);

create index if not exists return_photo_storage_usage_snapshots_captured_idx
  on public.return_photo_storage_usage_snapshots (captured_at desc);

alter table public.return_photo_storage_usage_snapshots enable row level security;
revoke all on table public.return_photo_storage_usage_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.return_photo_storage_usage_snapshots to service_role;
grant usage, select on sequence public.return_photo_storage_usage_snapshots_id_seq to service_role;

drop policy if exists "服务角色管理归还照片容量快照" on public.return_photo_storage_usage_snapshots;
create policy "服务角色管理归还照片容量快照"
  on public.return_photo_storage_usage_snapshots
  for all
  to service_role
  using (true)
  with check (true);

create or replace function private.enqueue_return_photo_archive_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.photo_deleted_at is null and new.supabase_deleted_at is null then
    insert into public.return_photo_archive_jobs (
      return_photo_id,
      borrow_record_id,
      request_id,
      request_number,
      item_id,
      item_name,
      item_model,
      serial_number_last4,
      source_bucket_id,
      source_storage_path
    )
    select
      new.id,
      record.id,
      request.id,
      request.request_number,
      item.id,
      item.name,
      item.model,
      right(item.serial_number, 4),
      'return-photos',
      new.storage_path
    from public.borrow_records as record
    join public.borrow_requests as request on request.id = record.request_id
    join public.items as item on item.id = record.item_id
    where record.id = new.borrow_record_id
    on conflict (return_photo_id) do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function private.enqueue_return_photo_archive_job()
  from public, anon, authenticated, service_role;

drop trigger if exists enqueue_return_photo_archive_job on public.return_photos;
create trigger enqueue_return_photo_archive_job
after insert on public.return_photos
for each row execute function private.enqueue_return_photo_archive_job();

insert into public.return_photo_archive_jobs (
  return_photo_id,
  borrow_record_id,
  request_id,
  request_number,
  item_id,
  item_name,
  item_model,
  serial_number_last4,
  source_bucket_id,
  source_storage_path
)
select
  photo.id,
  record.id,
  request.id,
  request.request_number,
  item.id,
  item.name,
  item.model,
  right(item.serial_number, 4),
  'return-photos',
  photo.storage_path
from public.return_photos as photo
join public.borrow_records as record on record.id = photo.borrow_record_id
join public.borrow_requests as request on request.id = record.request_id
join public.items as item on item.id = record.item_id
where photo.photo_deleted_at is null
  and photo.supabase_deleted_at is null
on conflict (return_photo_id) do update
set borrow_record_id = excluded.borrow_record_id,
    request_id = excluded.request_id,
    request_number = excluded.request_number,
    item_id = excluded.item_id,
    item_name = excluded.item_name,
    item_model = excluded.item_model,
    serial_number_last4 = excluded.serial_number_last4,
    source_bucket_id = excluded.source_bucket_id,
    source_storage_path = excluded.source_storage_path,
    updated_at = now();

alter table public.return_photo_archive_jobs
  alter column source_storage_path set not null;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'return_photo_archive_jobs_source_path_check'
      and conrelid = 'public.return_photo_archive_jobs'::regclass
  ) then
    alter table public.return_photo_archive_jobs
      add constraint return_photo_archive_jobs_source_path_check check (
        source_bucket_id = 'return-photos'
        and char_length(source_storage_path) between 1 and 1024
        and source_storage_path !~ '(^|/)\.\.(/|$)'
        and source_storage_path !~ '^/'
      );
  end if;
end;
$constraint$;

create or replace function public.claim_return_photo_archive_jobs(
  p_worker_id text,
  p_limit integer default 5,
  p_lease_minutes integer default 15
)
returns table (
  job_id uuid,
  lease_token uuid,
  return_photo_id uuid,
  source_bucket_id text,
  source_storage_path text,
  captured_at timestamptz,
  suggested_archive_path text,
  borrow_record_id uuid,
  request_id uuid,
  request_number text,
  item_id uuid,
  item_name text,
  item_model text,
  serial_number_last4 text
)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or char_length(p_worker_id) > 128 then
    raise exception 'Invalid worker id' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 20 or p_lease_minutes < 5 or p_lease_minutes > 60 then
    raise exception 'Invalid claim bounds' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select job.id
    from public.return_photo_archive_jobs as job
    where (
      job.status = 'pending'
      or (job.status = 'leased' and job.lease_expires_at < now())
    )
      and job.next_attempt_at <= now()
      and job.attempt_count < 10
    order by job.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.return_photo_archive_jobs as job
    set status = 'leased',
        attempt_count = job.attempt_count + 1,
        claimed_by = btrim(p_worker_id),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(mins => p_lease_minutes),
        last_error = null,
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select
    claimed.id,
    claimed.lease_token,
    photo.id,
    claimed.source_bucket_id,
    claimed.source_storage_path,
    photo.captured_at,
    to_char(photo.captured_at at time zone 'Asia/Shanghai', 'YYYY/MM/DD')
      || '/' || photo.id::text
      || case
           when lower(claimed.source_storage_path) like '%.png' then '.png'
           when lower(claimed.source_storage_path) like '%.jpeg' then '.jpeg'
           else '.jpg'
         end,
    claimed.borrow_record_id,
    claimed.request_id,
    claimed.request_number,
    claimed.item_id,
    claimed.item_name,
    claimed.item_model,
    claimed.serial_number_last4
  from claimed
  join public.return_photos as photo on photo.id = claimed.return_photo_id
  order by claimed.created_at;
end;
$function$;

revoke all on function public.claim_return_photo_archive_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_return_photo_archive_jobs(text, integer, integer)
  to service_role;

create or replace function public.fail_return_photo_archive_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_status text;
begin
  update public.return_photo_archive_jobs as job
  set status = case when job.attempt_count >= 10 then 'failed' else 'pending' end,
      next_attempt_at = now() + make_interval(mins => least(360, greatest(5, job.attempt_count * job.attempt_count * 5))),
      claimed_by = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'Unknown archive failure'), 2000),
      updated_at = now()
  where job.id = p_job_id
    and job.status = 'leased'
    and job.lease_token = p_lease_token
  returning job.status into v_status;

  if v_status is null then
    raise exception 'Archive job lease is invalid or expired' using errcode = '40001';
  end if;

  if v_status = 'failed' then
    insert into public.return_photo_archive_events (event_type, dedupe_key, payload)
    values (
      'sync_failed',
      'sync_failed:' || p_job_id::text,
      jsonb_build_object('job_id', p_job_id, 'error', left(coalesce(p_error, 'Unknown archive failure'), 2000))
    )
    on conflict (dedupe_key) do update
      set payload = excluded.payload,
          webhook_status = 'pending',
          next_attempt_at = now(),
          updated_at = now();
  end if;

  return v_status;
end;
$function$;

revoke all on function public.fail_return_photo_archive_job(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_return_photo_archive_job(uuid, uuid, text)
  to service_role;

create or replace function public.verify_return_photo_archive_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_nas_archive_path text,
  p_nas_size_bytes bigint,
  p_nas_sha256 text,
  p_source_size_bytes bigint,
  p_source_sha256 text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_photo_id uuid;
begin
  if coalesce(p_nas_size_bytes, 0) < 1 or coalesce(p_source_size_bytes, 0) < 1
     or p_nas_size_bytes <> p_source_size_bytes then
    raise exception 'Archive size verification failed' using errcode = '22000';
  end if;
  if lower(coalesce(p_nas_sha256, '')) !~ '^[0-9a-f]{64}$'
     or lower(p_nas_sha256) <> lower(coalesce(p_source_sha256, '')) then
    raise exception 'Archive SHA-256 verification failed' using errcode = '22000';
  end if;
  if p_nas_archive_path is null
     or char_length(p_nas_archive_path) not between 1 and 1024
     or p_nas_archive_path ~ '(^|/)\.\.(/|$)'
     or p_nas_archive_path ~ '^/' then
    raise exception 'Invalid NAS archive path' using errcode = '22023';
  end if;

  update public.return_photo_archive_jobs as job
  set status = 'verified',
      source_size_bytes = p_source_size_bytes,
      source_sha256 = lower(p_source_sha256),
      nas_size_bytes = p_nas_size_bytes,
      nas_sha256 = lower(p_nas_sha256),
      nas_archive_path = p_nas_archive_path,
      verified_at = now(),
      cleanup_retry_after = null,
      claimed_by = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now()
  where job.id = p_job_id
    and job.status = 'leased'
    and job.lease_token = p_lease_token
  returning job.return_photo_id into v_photo_id;

  if v_photo_id is null then
    raise exception 'Archive job lease is invalid or expired' using errcode = '40001';
  end if;

  update public.return_photos
  set nas_archived_at = now()
  where id = v_photo_id;

  insert into public.return_photo_archive_events (event_type, dedupe_key, payload)
  values (
    'sync_verified',
    'sync_verified:' || p_job_id::text,
    jsonb_build_object(
      'job_id', p_job_id,
      'return_photo_id', v_photo_id,
      'request_number', (select job.request_number from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'item_model', (select job.item_model from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'serial_number_last4', (select job.serial_number_last4 from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'source_bucket_id', (select job.source_bucket_id from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'source_storage_path', (select job.source_storage_path from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'nas_archive_path', p_nas_archive_path,
      'size_bytes', p_nas_size_bytes,
      'sha256', lower(p_nas_sha256)
    )
  )
  on conflict (dedupe_key) do nothing;

  return v_photo_id;
end;
$function$;

revoke all on function public.verify_return_photo_archive_job(uuid, uuid, text, bigint, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.verify_return_photo_archive_job(uuid, uuid, text, bigint, text, bigint, text)
  to service_role;

create or replace function public.claim_return_photo_cleanup_jobs(
  p_worker_id text,
  p_capacity_emergency boolean default false,
  p_limit integer default 20,
  p_lease_minutes integer default 15
)
returns table (
  job_id uuid,
  lease_token uuid,
  return_photo_id uuid,
  source_bucket_id text,
  source_storage_path text,
  source_size_bytes bigint
)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or char_length(p_worker_id) > 128 then
    raise exception 'Invalid worker id' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 100 or p_lease_minutes < 5 or p_lease_minutes > 60 then
    raise exception 'Invalid cleanup claim bounds' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select job.id
    from public.return_photo_archive_jobs as job
    join public.return_photo_archive_config as config on config.id = 1
    join public.return_photos as photo on photo.id = job.return_photo_id
    where config.cleanup_enabled
      and p_capacity_emergency
      and photo.supabase_deleted_at is null
      and exists (
        select 1
        from public.return_photo_archive_events as sync_event
        where sync_event.dedupe_key = 'sync_verified:' || job.id::text
          and sync_event.webhook_status = 'delivered'
      )
      and (
        (
          job.status = 'verified'
          and (job.cleanup_retry_after is null or job.cleanup_retry_after <= now())
        )
        or (job.status = 'deleting' and job.lease_expires_at < now())
      )
    order by job.verified_at
    for update of job skip locked
    limit p_limit
  ), claimed as (
    update public.return_photo_archive_jobs as job
    set status = 'deleting',
        claimed_by = btrim(p_worker_id),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(mins => p_lease_minutes),
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select
    claimed.id,
    claimed.lease_token,
    photo.id,
    claimed.source_bucket_id,
    claimed.source_storage_path,
    claimed.source_size_bytes
  from claimed
  join public.return_photos as photo on photo.id = claimed.return_photo_id
  where photo.supabase_deleted_at is null
  order by claimed.verified_at;
end;
$function$;

revoke all on function public.claim_return_photo_cleanup_jobs(text, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_return_photo_cleanup_jobs(text, boolean, integer, integer)
  to service_role;

create or replace function public.complete_return_photo_cleanup_job(
  p_job_id uuid,
  p_lease_token uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_photo_id uuid;
  v_source_bucket_id text;
  v_source_storage_path text;
begin
  update public.return_photo_archive_jobs as job
  set status = 'deleted',
      deleted_at = now(),
      claimed_by = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = now()
  where job.id = p_job_id
    and job.status = 'deleting'
    and job.lease_token = p_lease_token
    and job.verified_at is not null
    and job.nas_sha256 = job.source_sha256
    and job.nas_size_bytes = job.source_size_bytes
  returning job.return_photo_id, job.source_bucket_id, job.source_storage_path
  into v_photo_id, v_source_bucket_id, v_source_storage_path;

  if v_photo_id is null then
    raise exception 'Cleanup job lease or archive verification is invalid' using errcode = '40001';
  end if;

  update public.return_photos
  set supabase_deleted_at = now()
  where id = v_photo_id;

  insert into public.return_photo_archive_events (event_type, dedupe_key, payload)
  values (
    'cleanup_deleted',
    'cleanup_deleted:' || p_job_id::text,
    jsonb_build_object(
      'job_id', p_job_id,
      'return_photo_id', v_photo_id,
      'request_number', (select job.request_number from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'item_model', (select job.item_model from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'serial_number_last4', (select job.serial_number_last4 from public.return_photo_archive_jobs as job where job.id = p_job_id),
      'source_bucket_id', v_source_bucket_id,
      'source_storage_path', v_source_storage_path,
      'storage_path', v_source_storage_path
    )
  )
  on conflict (dedupe_key) do nothing;

  return v_photo_id;
end;
$function$;

revoke all on function public.complete_return_photo_cleanup_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_return_photo_cleanup_job(uuid, uuid)
  to service_role;

create or replace function public.fail_return_photo_cleanup_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_photo_id uuid;
begin
  update public.return_photo_archive_jobs as job
  set status = 'verified',
      cleanup_retry_after = now() + interval '30 minutes',
      claimed_by = null,
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_error, 'Unknown cleanup failure'), 2000),
      updated_at = now()
  where job.id = p_job_id
    and job.status = 'deleting'
    and job.lease_token = p_lease_token
  returning job.return_photo_id into v_photo_id;

  if v_photo_id is null then
    raise exception 'Cleanup job lease is invalid or expired' using errcode = '40001';
  end if;

  insert into public.return_photo_archive_events (event_type, dedupe_key, payload)
  values (
    'cleanup_failed',
    'cleanup_failed:' || p_job_id::text || ':' || to_char(now(), 'YYYYMMDDHH24'),
    jsonb_build_object(
      'job_id', p_job_id,
      'return_photo_id', v_photo_id,
      'error', left(coalesce(p_error, 'Unknown cleanup failure'), 2000)
    )
  )
  on conflict (dedupe_key) do nothing;

  return v_photo_id;
end;
$function$;

revoke all on function public.fail_return_photo_cleanup_job(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_return_photo_cleanup_job(uuid, uuid, text)
  to service_role;

create or replace function public.claim_return_photo_archive_events(
  p_limit integer default 20
)
returns table (
  event_id uuid,
  event_type text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid event claim limit' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select event.id
    from public.return_photo_archive_events as event
    where (
      event.webhook_status in ('pending', 'failed')
      or (event.webhook_status = 'delivering' and event.updated_at < now() - interval '10 minutes')
    )
      and event.next_attempt_at <= now()
    order by event.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.return_photo_archive_events as event
    set webhook_status = 'delivering',
        attempt_count = event.attempt_count + 1,
        last_error = null,
        updated_at = now()
    from candidates
    where event.id = candidates.id
    returning event.*
  )
  select claimed.id, claimed.event_type, claimed.payload, claimed.created_at
  from claimed
  order by claimed.created_at;
end;
$function$;

revoke all on function public.claim_return_photo_archive_events(integer)
  from public, anon, authenticated;
grant execute on function public.claim_return_photo_archive_events(integer)
  to service_role;

create or replace function public.complete_return_photo_archive_event(p_event_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.return_photo_archive_events as event
  set webhook_status = 'delivered',
      delivered_at = now(),
      last_error = null,
      updated_at = now()
  where event.id = p_event_id
    and event.webhook_status = 'delivering';

  if not found then
    raise exception 'Webhook event is not claimed' using errcode = '40001';
  end if;
end;
$function$;

revoke all on function public.complete_return_photo_archive_event(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_return_photo_archive_event(uuid)
  to service_role;

create or replace function public.fail_return_photo_archive_event(
  p_event_id uuid,
  p_error text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.return_photo_archive_events as event
  set webhook_status = 'failed',
      next_attempt_at = now() + make_interval(mins => least(360, greatest(5, event.attempt_count * event.attempt_count * 5))),
      last_error = left(coalesce(p_error, 'Unknown webhook failure'), 2000),
      updated_at = now()
  where event.id = p_event_id
    and event.webhook_status = 'delivering';

  if not found then
    raise exception 'Webhook event is not claimed' using errcode = '40001';
  end if;
end;
$function$;

revoke all on function public.fail_return_photo_archive_event(uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_return_photo_archive_event(uuid, text)
  to service_role;

create or replace function public.get_return_photo_archive_usage()
returns table (
  total_storage_bytes bigint,
  return_photo_storage_bytes bigint,
  database_bytes bigint,
  pending_archive_count bigint,
  verified_archive_count bigint,
  unlinked_return_photo_object_count bigint,
  unlinked_return_photo_object_bytes bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    coalesce(sum((object.metadata ->> 'size')::bigint), 0)::bigint,
    coalesce(sum((object.metadata ->> 'size')::bigint)
      filter (where object.bucket_id = 'return-photos'), 0)::bigint,
    pg_database_size(current_database())::bigint,
    (select count(*)::bigint from public.return_photo_archive_jobs as job where job.status in ('pending', 'leased', 'failed')),
    (select count(*)::bigint from public.return_photo_archive_jobs as job where job.status in ('verified', 'deleting')),
    count(*) filter (
      where object.bucket_id = 'return-photos'
        and not exists (
          select 1
          from public.return_photos as photo
          where photo.storage_path = object.name
        )
    )::bigint,
    coalesce(sum((object.metadata ->> 'size')::bigint) filter (
      where object.bucket_id = 'return-photos'
        and not exists (
          select 1
          from public.return_photos as photo
          where photo.storage_path = object.name
        )
    ), 0)::bigint
  from storage.objects as object;
$function$;

revoke all on function public.get_return_photo_archive_usage()
  from public, anon, authenticated;
grant execute on function public.get_return_photo_archive_usage()
  to service_role;

comment on table public.return_photo_archive_config is
  'Service-managed NAS archive thresholds. Authenticated users may read only the LAN viewer URL and non-secret policy values.';
comment on table public.return_photo_archive_jobs is
  'Service-only state machine proving NAS copy size and SHA-256 before Supabase Storage deletion.';
comment on column public.return_photo_archive_jobs.source_bucket_id is
  'Original Supabase Storage bucket retained for a controlled restore; fixed to return-photos.';
comment on column public.return_photo_archive_jobs.source_storage_path is
  'Original Supabase object path retained in the database and copied into the NAS manifest/sidecar.';
comment on column public.return_photo_archive_jobs.cleanup_retry_after is
  'Retry throttle after a failed delete. It is not an age-based cleanup time; Storage must be at least the configured cleanup threshold.';
comment on table public.return_photo_archive_events is
  'Transactional outbox for the dedicated NAS archive webhook; webhook URL is held only in Edge Function secrets.';
comment on table public.return_photo_storage_usage_snapshots is
  'Service-only capacity history used for threshold warnings and remaining-time estimates.';

-- Schedule only when deployment has provisioned the matching Vault secret.
select cron.unschedule(jobid)
from cron.job
where jobname = 'monitor_return_photo_archive';

do $function$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'return_photo_archive_cron_secret') then
    perform cron.schedule(
      'monitor_return_photo_archive',
      '3,13,23,33,43,53 * * * *',
      $schedule$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'project_url'
        ) || '/functions/v1/monitor-return-photo-archive',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'return_photo_archive_cron_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
      $schedule$
    );
  else
    raise warning 'project_url/return_photo_archive_cron_secret Vault secrets missing; NAS archive monitor was not scheduled';
  end if;
end;
$function$;

notify pgrst, 'reload schema';
