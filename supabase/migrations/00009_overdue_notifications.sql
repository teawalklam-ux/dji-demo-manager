-- 逾期通知表
CREATE TABLE public.overdue_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_record_id UUID NOT NULL REFERENCES public.borrow_records(id),
  borrower_id UUID NOT NULL REFERENCES public.profiles(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('email', 'push', 'sms', 'wecom')),
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_read BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_overdue_notifications_borrower ON public.overdue_notifications(borrower_id);
CREATE INDEX idx_overdue_notifications_read ON public.overdue_notifications(is_read);
