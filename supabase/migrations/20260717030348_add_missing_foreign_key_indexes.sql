-- PostgreSQL does not automatically index referencing foreign-key columns.
-- These tables are currently small, so regular CREATE INDEX keeps this migration
-- transaction-safe while adding negligible lock time.
create index if not exists approval_records_chain_id_idx
  on public.approval_records (chain_id);

create index if not exists borrow_records_request_id_idx
  on public.borrow_records (request_id);

create index if not exists borrow_requests_parent_request_id_idx
  on public.borrow_requests (parent_request_id);

create index if not exists items_current_borrower_id_idx
  on public.items (current_borrower_id);

create index if not exists overdue_notifications_borrow_record_id_idx
  on public.overdue_notifications (borrow_record_id);

create index if not exists overdue_notifications_borrow_request_id_idx
  on public.overdue_notifications (borrow_request_id);

create index if not exists return_photos_uploader_id_idx
  on public.return_photos (uploader_id);

create index if not exists stock_movements_borrow_record_id_idx
  on public.stock_movements (borrow_record_id);

create index if not exists stock_movements_operator_id_idx
  on public.stock_movements (operator_id);
