-- 借用记录表
CREATE TABLE public.borrow_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.borrow_requests(id),
  item_id UUID NOT NULL REFERENCES public.items(id),
  borrower_id UUID NOT NULL REFERENCES public.profiles(id),
  borrow_type TEXT NOT NULL CHECK (borrow_type IN ('customer', 'marketing')),
  borrow_date DATE NOT NULL,
  due_date DATE NOT NULL,
  return_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'returned', 'overdue')),
  overdue_days INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_borrow_records_item ON public.borrow_records(item_id);
CREATE INDEX idx_borrow_records_borrower ON public.borrow_records(borrower_id);
CREATE INDEX idx_borrow_records_status ON public.borrow_records(status);
CREATE INDEX idx_borrow_records_due_date ON public.borrow_records(due_date);
