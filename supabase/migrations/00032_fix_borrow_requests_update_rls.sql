-- 修复 borrow_requests UPDATE RLS 策略
-- 错误: new row violates row-level security policy for table "borrow_requests"
-- 根因: 原策略只有 USING 没有 WITH CHECK, 默认 WITH CHECK = USING
--   USING (requester_id = auth.uid() AND status = 'pending')
--   当 status 从 pending 改为 cancelled/renewal_requested 后, 新行不满足 status='pending', 被拒绝
-- 修复:
--   USING: 申请人可选中自己的申请(不限状态)
--   WITH CHECK: 新行必须仍是本人, 且状态只能是用户可设置的(pending/cancelled/renewal_requested)
--   审批状态变更(approved/rejected)通过 process_approval SECURITY DEFINER 函数完成, 不受 RLS 限制

DROP POLICY IF EXISTS "申请人可取消自己的申请" ON public.borrow_requests;

CREATE POLICY "申请人可更新自己的申请"
  ON public.borrow_requests FOR UPDATE
  USING (requester_id = (select auth.uid()))
  WITH CHECK (
    requester_id = (select auth.uid())
    AND status IN ('pending', 'cancelled', 'renewal_requested')
  );
