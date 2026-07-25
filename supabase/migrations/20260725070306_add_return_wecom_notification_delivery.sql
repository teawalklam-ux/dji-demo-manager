alter table public.overdue_notifications
  drop constraint if exists overdue_notifications_notification_category_check;

alter table public.overdue_notifications
  add constraint overdue_notifications_notification_category_check
  check (notification_category in ('overdue', 'approval', 'return'));

create unique index if not exists overdue_notifications_return_wecom_once_idx
  on public.overdue_notifications (borrow_record_id)
  where notification_category = 'return'
    and notification_type = 'wecom'
    and borrow_record_id is not null;

comment on index public.overdue_notifications_return_wecom_once_idx is
  'Ensures each returned borrow record produces at most one WeCom return notification.';
