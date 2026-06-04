-- 扩展 overdue_notifications 为通用通知表
-- 增加 notification_category 区分通知类型（overdue=逾期, approval=审批）
-- 增加 recipient_id 替代 borrower_id（审批通知的接收人不一定是借用人）

-- 1. 添加 notification_category 列
ALTER TABLE public.overdue_notifications
ADD COLUMN IF NOT EXISTS notification_category TEXT NOT NULL DEFAULT 'overdue'
CHECK (notification_category IN ('overdue', 'approval'));

-- 2. 添加 recipient_id 列（审批通知的接收人是审批人，不是借用人）
ALTER TABLE public.overdue_notifications
ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES public.profiles(id);

-- 3. 为兼容旧数据，将已有记录的 recipient_id 设为 borrower_id
UPDATE public.overdue_notifications
SET recipient_id = borrower_id
WHERE recipient_id IS NULL;

-- 4. 添加 borrow_request_id 列（审批通知关联的是借用申请，非借用记录）
ALTER TABLE public.overdue_notifications
ADD COLUMN IF NOT EXISTS borrow_request_id UUID REFERENCES public.borrow_requests(id);

-- 5. 将 borrower_id 改为可空（审批通知时 borrower_id 可能无意义）
ALTER TABLE public.overdue_notifications ALTER COLUMN borrow_record_id DROP NOT NULL;
ALTER TABLE public.overdue_notifications ALTER COLUMN borrower_id DROP NOT NULL;

-- 6. 添加索引
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.overdue_notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON public.overdue_notifications(notification_category);

-- 7. 更新 RLS 策略：用户可查看发给自己的通知
DROP POLICY IF EXISTS "用户可查看自己的通知" ON public.overdue_notifications;
CREATE POLICY "用户可查看自己的通知"
  ON public.overdue_notifications FOR SELECT
  USING (
    borrower_id = (select auth.uid())
    OR recipient_id = (select auth.uid())
  );

-- 8. 更新 RLS 策略：用户可更新自己的通知为已读
DROP POLICY IF EXISTS "用户可更新自己的通知为已读" ON public.overdue_notifications;
CREATE POLICY "用户可更新自己的通知为已读"
  ON public.overdue_notifications FOR UPDATE
  USING (
    borrower_id = (select auth.uid())
    OR recipient_id = (select auth.uid())
  );

-- 9. 允许 service_role 插入通知（Edge Function 用）
-- 也允许通过 SECURITY DEFINER 函数插入（无需额外策略）
