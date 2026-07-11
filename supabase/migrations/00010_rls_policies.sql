-- ===== RLS 策略 =====

-- 辅助函数: 获取当前用户角色
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = (select auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ===== profiles =====
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看所有活跃用户"
  ON public.profiles FOR SELECT
  USING (is_active = true);

CREATE POLICY "用户可更新自己的资料"
  ON public.profiles FOR UPDATE
  USING (id = (select auth.uid()));

CREATE POLICY "管理员可更新任何用户"
  ON public.profiles FOR UPDATE
  USING (public.get_current_user_role() = 'admin');

-- ===== categories =====
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有人可查看活跃分类"
  ON public.categories FOR SELECT
  USING (is_active = true OR public.get_current_user_role() = 'admin');

CREATE POLICY "管理员可管理分类"
  ON public.categories FOR ALL
  USING (public.get_current_user_role() = 'admin');

-- ===== items =====
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有登录用户可查看样机"
  ON public.items FOR SELECT
  USING (true);

CREATE POLICY "管理员可新增样机"
  ON public.items FOR INSERT
  WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY "管理员可更新样机"
  ON public.items FOR UPDATE
  USING (public.get_current_user_role() = 'admin');

CREATE POLICY "管理员可删除样机"
  ON public.items FOR DELETE
  USING (public.get_current_user_role() = 'admin');

-- ===== borrow_requests =====
ALTER TABLE public.borrow_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看自己的申请"
  ON public.borrow_requests FOR SELECT
  USING (
    requester_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'approver')
  );

CREATE POLICY "用户可创建申请"
  ON public.borrow_requests FOR INSERT
  WITH CHECK (requester_id = (select auth.uid()));

CREATE POLICY "申请人可更新自己的申请"
  ON public.borrow_requests FOR UPDATE
  USING (requester_id = (select auth.uid()))
  WITH CHECK (
    requester_id = (select auth.uid())
    AND status IN ('pending', 'cancelled', 'renewal_requested')
  );

-- ===== approval_chains =====
ALTER TABLE public.approval_chains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有登录用户可查看审批链"
  ON public.approval_chains FOR SELECT
  USING (is_active = true OR public.get_current_user_role() = 'admin');

CREATE POLICY "管理员可管理审批链"
  ON public.approval_chains FOR ALL
  USING (public.get_current_user_role() = 'admin');

-- ===== approval_records =====
ALTER TABLE public.approval_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "相关人员可查看审批记录"
  ON public.approval_records FOR SELECT
  USING (
    approver_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.borrow_requests br
      WHERE br.id = request_id AND br.requester_id = (select auth.uid())
    )
    OR public.get_current_user_role() = 'admin'
  );

CREATE POLICY "审批人可创建审批记录"
  ON public.approval_records FOR INSERT
  WITH CHECK (approver_id = (select auth.uid()) AND public.get_current_user_role() IN ('admin', 'approver'));

-- ===== borrow_records =====
ALTER TABLE public.borrow_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "借用人或管理员可查看借用记录"
  ON public.borrow_records FOR SELECT
  USING (
    borrower_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'approver')
  );

-- ===== stock_movements =====
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有登录用户可查看库存变动"
  ON public.stock_movements FOR SELECT
  USING (true);

CREATE POLICY "管理员可创建库存变动"
  ON public.stock_movements FOR INSERT
  WITH CHECK (public.get_current_user_role() = 'admin');

-- ===== overdue_notifications =====
ALTER TABLE public.overdue_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看自己的通知"
  ON public.overdue_notifications FOR SELECT
  USING (borrower_id = (select auth.uid()));

CREATE POLICY "用户可更新自己的通知为已读"
  ON public.overdue_notifications FOR UPDATE
  USING (borrower_id = (select auth.uid()));
