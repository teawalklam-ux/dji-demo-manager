-- 修复 approval_records.action 的 NOT NULL 约束
-- 审批记录创建时尚未审批，action 应该允许为 NULL
-- 审批操作发生后才填入 'approved' 或 'rejected'

ALTER TABLE public.approval_records
  ALTER COLUMN action DROP NOT NULL;
