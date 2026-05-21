-- 借用申请表
CREATE TABLE public.borrow_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT NOT NULL UNIQUE,
  requester_id UUID NOT NULL REFERENCES public.profiles(id),
  item_id UUID NOT NULL REFERENCES public.items(id),
  borrow_type TEXT NOT NULL CHECK (borrow_type IN ('customer', 'marketing')),
  purpose TEXT NOT NULL,
  customer_name TEXT,
  customer_contact TEXT,
  expected_borrow_date DATE NOT NULL,
  expected_return_date DATE NOT NULL,
  actual_borrow_date DATE,
  actual_return_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'partially_approved', 'rejected', 'cancelled',
                      'borrowed', 'returned', 'overdue', 'renewal_requested')),
  parent_request_id UUID REFERENCES public.borrow_requests(id),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_borrow_requests_requester ON public.borrow_requests(requester_id);
CREATE INDEX idx_borrow_requests_item ON public.borrow_requests(item_id);
CREATE INDEX idx_borrow_requests_status ON public.borrow_requests(status);
