-- Restrict the reservation notification worker to a dedicated credential.
-- Provision the same random value as:
--   Edge Function secret: RESERVATION_EVENTS_CRON_SECRET
--   Vault secret: reservation_events_cron_secret
-- before applying this migration. The worker deliberately fails closed when
-- either side is missing.

select cron.unschedule(jobid)
from cron.job
where jobname = 'notify_reservation_events';

do $function$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'project_url')
     and exists (
       select 1
       from vault.decrypted_secrets
       where name = 'reservation_events_cron_secret'
     ) then
    perform cron.schedule(
      'notify_reservation_events',
      '*/5 * * * *',
      $schedule$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'project_url'
        ) || '/functions/v1/notify-reservation-events',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'reservation_events_cron_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
      $schedule$
    );
  else
    raise warning 'project_url/reservation_events_cron_secret Vault secrets missing; reservation event notifier was not scheduled';
  end if;
end;
$function$;
