-- Web client telemetry for operational troubleshooting. These entries are
-- append-only and intentionally separate from authoritative approval and stock
-- audit records.

create table public.app_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid default auth.uid() references public.profiles(id) on delete set null,
  level text not null check (level in ('info', 'warn', 'error')),
  category text not null check (category in ('navigation', 'ui', 'api', 'business', 'system')),
  event text not null check (char_length(event) between 1 and 80),
  message text not null default '' check (char_length(message) <= 500),
  route text check (route is null or char_length(route) <= 240),
  correlation_id uuid not null,
  context jsonb not null default '{}'::jsonb,
  client_occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint app_logs_context_shape_check check (
    jsonb_typeof(context) = 'object'
    and octet_length(context::text) <= 4096
  )
);

create index app_logs_created_at_idx
on public.app_logs (created_at desc);

create index app_logs_level_created_at_idx
on public.app_logs (level, created_at desc);

create index app_logs_category_created_at_idx
on public.app_logs (category, created_at desc);

create index app_logs_actor_id_created_at_idx
on public.app_logs (actor_id, created_at desc);

-- A single private counter makes the 50,000-row ceiling transactional without
-- running COUNT(*) over the log table for every browser event. The row lock also
-- serializes the low-volume insert path, which is appropriate for this small
-- Free Plan deployment.
create table private.app_log_state (
  singleton boolean primary key default true check (singleton),
  row_count bigint not null default 0 check (row_count >= 0)
);

insert into private.app_log_state (singleton, row_count)
values (true, 0);

revoke all on table private.app_log_state
from public, anon, authenticated, service_role;

create or replace function private.track_app_log_deletes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count bigint;
begin
  select count(*) into v_deleted_count from deleted_app_logs;

  update private.app_log_state
  set row_count = greatest(0, row_count - v_deleted_count)
  where singleton;

  return null;
end;
$$;

revoke all on function private.track_app_log_deletes()
from public, anon, authenticated, service_role;

create trigger track_app_log_deletes
after delete on public.app_logs
referencing old table as deleted_app_logs
for each statement execute function private.track_app_log_deletes();

-- Keep the browser payload narrow even if a custom client calls the Data API.
-- Unknown context keys are discarded, routes never retain query strings, and
-- the server timestamp remains the ordering authority.
create or replace function private.redact_app_log_text(
  p_value text,
  p_max_length integer
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(p_value, '(bearer[[:space:]]+)[A-Za-z0-9._~+/-]+=*', E'\\1[REDACTED]', 'gi'),
          '(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})',
          '[REDACTED]',
          'g'
        ),
        '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
        '[EMAIL]',
        'g'
      ),
      '(^|[^0-9])1[3-9][0-9]{9}([^0-9]|$)',
      E'\\1[PHONE]\\2',
      'g'
    ),
    least(greatest(p_max_length, 0), 1200)
  );
$$;

revoke all on function private.redact_app_log_text(text, integer)
from public, anon, authenticated, service_role;

create or replace function private.normalize_app_log_insert()
returns trigger
language plpgsql
-- The trigger needs owner privileges only to count recent rows while log
-- writers intentionally have no SELECT access. It is private, has an empty
-- search path, and EXECUTE is revoked from every API role below.
security definer
set search_path = ''
as $$
declare
  v_total_count bigint;
begin
  if (select auth.uid()) is null
     or new.actor_id is distinct from (select auth.uid())
     or not (select private.is_current_user_active()) then
    raise exception '无权写入系统日志' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.app_logs as recent_log
    where recent_log.actor_id = (select auth.uid())
      and recent_log.created_at >= now() - interval '5 minutes'
  ) >= 30 then
    raise exception '日志写入过于频繁' using errcode = 'P0001';
  end if;

  update private.app_log_state
  set row_count = row_count + 1
  where singleton
  returning row_count into v_total_count;

  if v_total_count > 50000 then
    delete from public.app_logs
    where id in (
      select old_log.id
      from public.app_logs as old_log
      order by old_log.created_at, old_log.id
      limit 1000
    );
  end if;

  new.event := left(trim(new.event), 80);
  new.message := private.redact_app_log_text(new.message, 500);
  new.route := nullif(left(split_part(split_part(coalesce(new.route, ''), '?', 1), '#', 1), 240), '');
  new.client_occurred_at := greatest(
    least(coalesce(new.client_occurred_at, now()), now() + interval '5 minutes'),
    now() - interval '7 days'
  );
  new.context := jsonb_strip_nulls(jsonb_build_object(
    'component', nullif(private.redact_app_log_text(new.context ->> 'component', 100), ''),
    'operation', nullif(private.redact_app_log_text(new.context ->> 'operation', 100), ''),
    'error_name', nullif(private.redact_app_log_text(new.context ->> 'error_name', 80), ''),
    'stack', nullif(private.redact_app_log_text(new.context ->> 'stack', 1200), ''),
    'filename', nullif(left(split_part(split_part(new.context ->> 'filename', '?', 1), '#', 1), 240), ''),
    'line', nullif(left(new.context ->> 'line', 12), ''),
    'column', nullif(left(new.context ->> 'column', 12), ''),
    'status_code', nullif(left(new.context ->> 'status_code', 12), ''),
    'method', nullif(left(upper(new.context ->> 'method'), 12), ''),
    'duration_ms', nullif(left(new.context ->> 'duration_ms', 16), '')
  ));

  return new;
end;
$$;

revoke all on function private.normalize_app_log_insert()
from public, anon, authenticated, service_role;

create trigger normalize_app_log_before_insert
before insert on public.app_logs
for each row execute function private.normalize_app_log_insert();

alter table public.app_logs enable row level security;

revoke all on table public.app_logs from anon, authenticated;
grant select, insert on table public.app_logs to authenticated;

create policy "有效用户可写入自己的客户端日志"
on public.app_logs
for insert
to authenticated
with check (
  actor_id = (select auth.uid())
  and (select private.is_current_user_active())
);

create policy "管理员可查看系统日志"
on public.app_logs
for select
to authenticated
using (
  (select private.get_current_user_role()) in ('admin', 'super_admin')
);

-- Remove records older than 30 days in bounded batches. The hard ceiling above
-- ensures ten batches are enough even if the scheduled job was paused earlier.
create or replace function private.prune_app_logs()
returns integer
language plpgsql
security invoker
set search_path = ''
set lock_timeout = '2s'
set statement_timeout = '30s'
as $$
declare
  v_batch_count integer;
  v_total_count integer := 0;
begin
  for v_iteration in 1..10 loop
    with expired_logs as (
      select old_log.id
      from public.app_logs as old_log
      where old_log.created_at < now() - interval '30 days'
      order by old_log.created_at, old_log.id
      limit 5000
    )
    delete from public.app_logs as target_log
    using expired_logs
    where target_log.id = expired_logs.id;

    get diagnostics v_batch_count = row_count;
    v_total_count := v_total_count + v_batch_count;
    exit when v_batch_count < 5000;
  end loop;

  return v_total_count;
end;
$$;

revoke all on function private.prune_app_logs()
from public, anon, authenticated, service_role;

-- pg_cron uses UTC. 18:20/18:30 UTC are 02:20/02:30 the next day in
-- Asia/Shanghai. The second job prevents pg_cron's own history from growing
-- without bound; pg_net response rows are already empty and their allocated
-- pages remain reusable, so no locking VACUUM FULL is scheduled here.
select cron.unschedule(jobid)
from cron.job
where jobname in ('prune_app_logs_daily', 'prune_cron_history_daily');

select cron.schedule(
  'prune_app_logs_daily',
  '20 18 * * *',
  $$select private.prune_app_logs();$$
);

select cron.schedule(
  'prune_cron_history_daily',
  '30 18 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days';$$
);

comment on table public.app_logs is
  'Append-only, untrusted web-client telemetry for administrators; retained for 30 days and capped at 50,000 rows; not a replacement for business audit records.';

comment on column public.app_logs.context is
  'Server-allowlisted diagnostic context. Form values, credentials, tokens and arbitrary objects are intentionally excluded.';
