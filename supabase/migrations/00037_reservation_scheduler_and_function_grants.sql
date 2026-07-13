-- Keep SECURITY DEFINER functions unavailable to anon even when the database
-- has a default EXECUTE grant for newly created functions.
REVOKE ALL ON FUNCTION public.check_borrow_availability(UUID[], DATE, DATE, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_borrow_request(UUID) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_due_borrow_requests(DATE) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.create_borrow_request(UUID, UUID[], TEXT, TEXT, DATE, DATE, TEXT, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.process_approval(UUID, TEXT, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.process_return(UUID, TEXT, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_approval(UUID, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.check_borrow_availability(UUID[], DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_borrow_request(UUID, UUID[], TEXT, TEXT, DATE, DATE, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_approval(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_return(UUID, TEXT, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_approval(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_due_borrow_requests(DATE) TO service_role;

-- pg_cron is scheduled in UTC. 16:05 UTC is 00:05 on the following day in Asia/Shanghai.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'activate_due_borrow_requests_daily';

SELECT cron.schedule(
  'activate_due_borrow_requests_daily',
  '5 16 * * *',
  $$SELECT public.activate_due_borrow_requests((now() AT TIME ZONE 'Asia/Shanghai')::date);$$
);
