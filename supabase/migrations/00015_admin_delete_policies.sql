-- 管理员可删除借用申请
CREATE POLICY "管理员可删除借用申请"
  ON public.borrow_requests FOR DELETE
  USING (public.get_current_user_role() = 'admin');

-- 管理员可删除审批记录
CREATE POLICY "管理员可删除审批记录"
  ON public.approval_records FOR DELETE
  USING (public.get_current_user_role() = 'admin');

-- 管理员可删除借用记录
CREATE POLICY "管理员可删除借用记录"
  ON public.borrow_records FOR DELETE
  USING (public.get_current_user_role() = 'admin');

-- 管理员可删除库存变动记录
CREATE POLICY "管理员可删除库存变动记录"
  ON public.stock_movements FOR DELETE
  USING (public.get_current_user_role() = 'admin');

-- 管理员可删除逾期通知
CREATE POLICY "管理员可删除逾期通知"
  ON public.overdue_notifications FOR DELETE
  USING (public.get_current_user_role() = 'admin');
