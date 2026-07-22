-- Borrow-record reports must not depend on the once-daily overdue refresh job.
-- Derive status and overdue days from CURRENT_DATE whenever the report is read.
create or replace function public.get_borrow_records_report(
  p_status text default null,
  p_borrower_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      to_jsonb(record)
      || jsonb_build_object(
        'status', derived.report_status,
        'overdue_days', derived.report_overdue_days,
        'borrower', to_jsonb(borrower),
        'item', to_jsonb(item)
      )
      order by record.created_at desc
    ),
    '[]'::jsonb
  )
  from public.borrow_records as record
  cross join lateral (
    select
      case
        when record.status <> 'returned' and record.due_date < current_date then 'overdue'
        else record.status
      end as report_status,
      case
        when record.status = 'returned' then coalesce(record.overdue_days, 0)
        else greatest(current_date - record.due_date, 0)
      end as report_overdue_days
  ) as derived
  left join public.profiles as borrower on borrower.id = record.borrower_id
  left join public.items as item on item.id = record.item_id
  where (p_status is null or derived.report_status = p_status)
    and (p_borrower_id is null or record.borrower_id = p_borrower_id);
$$;

revoke all on function public.get_borrow_records_report(text, uuid) from public, anon, authenticated;
grant execute on function public.get_borrow_records_report(text, uuid) to authenticated, service_role;
