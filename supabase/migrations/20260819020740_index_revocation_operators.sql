create index if not exists borrow_requests_revoked_by_idx
  on public.borrow_requests (revoked_by);

create index if not exists borrow_records_revoked_by_idx
  on public.borrow_records (revoked_by);

notify pgrst, 'reload schema';
