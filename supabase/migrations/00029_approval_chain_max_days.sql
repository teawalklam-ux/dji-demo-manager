-- ===== 审批链添加最大借用天数限制 =====
ALTER TABLE public.approval_chains
  ADD COLUMN IF NOT EXISTS max_borrow_days INTEGER;

COMMENT ON COLUMN public.approval_chains.max_borrow_days IS '最大可申请天数，NULL表示不限制';

-- 营销演示审批链设为3天
UPDATE public.approval_chains
  SET max_borrow_days = 3
  WHERE borrow_type = 'marketing';
