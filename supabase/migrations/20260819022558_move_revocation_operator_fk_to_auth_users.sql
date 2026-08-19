-- Keep the revocation operator IDs referentially valid without creating a
-- second public.profiles relationship. A second relationship makes legacy
-- PostgREST embeds such as requester:profiles(*) and borrower:profiles(*)
-- ambiguous, causing approval and notification lists to return HTTP 300.
alter table public.borrow_requests
  drop constraint if exists borrow_requests_revoked_by_fkey;

alter table public.borrow_requests
  add constraint borrow_requests_revoked_by_fkey
  foreign key (revoked_by)
  references auth.users(id)
  on delete set null;

alter table public.borrow_records
  drop constraint if exists borrow_records_revoked_by_fkey;

alter table public.borrow_records
  add constraint borrow_records_revoked_by_fkey
  foreign key (revoked_by)
  references auth.users(id)
  on delete set null;

notify pgrst, 'reload schema';
