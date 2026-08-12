-- Keep the reservation event outbox service-only while making that intent
-- explicit to the database linter, and cover every foreign-key lookup path.

create policy reservation_events_deny_authenticated
on public.reservation_events
for all
to authenticated
using (false)
with check (false);

create index if not exists reservation_events_item_id_idx
  on public.reservation_events (item_id);
create index if not exists reservation_events_overdue_borrow_record_id_idx
  on public.reservation_events (overdue_borrow_record_id);
create index if not exists reservation_events_reservation_requester_id_idx
  on public.reservation_events (reservation_requester_id);
create index if not exists reservation_events_overdue_borrower_id_idx
  on public.reservation_events (overdue_borrower_id);
create index if not exists reservation_events_final_approver_id_idx
  on public.reservation_events (final_approver_id);
