-- 审批链配置表
CREATE TABLE public.approval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  borrow_type TEXT NOT NULL CHECK (borrow_type IN ('customer', 'marketing', 'all')),
  steps JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.approval_chains.steps IS '审批步骤定义, 格式: [{"level":1, "type":"role", "role":"approver", "label":"销售主管审批"}, {"level":2, "type":"person", "user_id":"uuid", "label":"张总确认"}]';
