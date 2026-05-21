-- 审批记录表
CREATE TABLE public.approval_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.borrow_requests(id) ON DELETE CASCADE,
  chain_id UUID NOT NULL REFERENCES public.approval_chains(id),
  approver_id UUID NOT NULL REFERENCES public.profiles(id),
  step_level INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  comment TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_records_request ON public.approval_records(request_id);
CREATE INDEX idx_approval_records_approver ON public.approval_records(approver_id);
