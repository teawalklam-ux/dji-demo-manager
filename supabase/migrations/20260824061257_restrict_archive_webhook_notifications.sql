-- Restrict archive Webhooks to synchronization, capacity warnings, and a
-- delivered pre-cleanup notice. Cleanup completion/failure remains auditable
-- on the archive job itself without generating additional group messages.

alter table public.return_photo_archive_events
  drop constraint return_photo_archive_events_event_type_check;

alter table public.return_photo_archive_events
  add constraint return_photo_archive_events_event_type_check check (
    event_type in (
      'sync_verified',
      'sync_failed',
      'cleanup_planned',
      'cleanup_deleted',
      'cleanup_failed',
      'storage_warning',
      'storage_critical',
      'database_warning',
      'database_critical',
      'unlinked_storage_objects'
    )
  );

create index if not exists return_photo_archive_events_cleanup_notice_idx
  on public.return_photo_archive_events (delivered_at desc)
  where event_type = 'cleanup_planned'
    and webhook_status = 'delivered';

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
      and job.verified_at is not null
      and job.nas_sha256 = job.source_sha256
      and job.nas_size_bytes = job.source_size_bytes
      and exists (
        select 1
        from public.return_photo_archive_events as sync_event
        where sync_event.dedupe_key = 'sync_verified:' || job.id::text
          and sync_event.webhook_status = 'delivered'
      )
      and exists (
        select 1
        from public.return_photo_archive_events as cleanup_notice
        where cleanup_notice.dedupe_key = 'cleanup_planned:'
          || to_char(timezone('Asia/Shanghai', now()), 'YYYY-MM-DD')
          and cleanup_notice.event_type = 'cleanup_planned'
          and cleanup_notice.webhook_status = 'delivered'
          and cleanup_notice.delivered_at <= now() - interval '5 minutes'
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
  returning job.return_photo_id into v_photo_id;

  if v_photo_id is null then
    raise exception 'Cleanup job lease or archive verification is invalid' using errcode = '40001';
  end if;

  update public.return_photos
  set supabase_deleted_at = now()
  where id = v_photo_id;

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
    where event.event_type in (
      'sync_verified',
      'sync_failed',
      'cleanup_planned',
      'storage_warning',
      'storage_critical',
      'database_warning',
      'database_critical'
    )
      and (
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

comment on index public.return_photo_archive_events_cleanup_notice_idx is
  'Supports the delivered pre-cleanup Webhook gate without scanning the complete outbox.';
comment on function public.claim_return_photo_cleanup_jobs(text, boolean, integer, integer) is
  'Claims verified NAS archives only after Storage is at least 80% and the current Beijing-day cleanup notice has been delivered for at least five minutes.';
