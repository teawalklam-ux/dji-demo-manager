-- ===== 修复 RLS 策略：super_admin 也应拥有 admin 的权限 =====

-- 1. profiles: 更新策略（00018已处理，但保留兼容）
DROP POLICY IF EXISTS "管理员可更新任何用户" ON public.profiles;

-- 2. categories
DROP POLICY IF EXISTS "所有人可查看活跃分类" ON public.categories;
CREATE POLICY "所有人可查看活跃分类"
  ON public.categories FOR SELECT
  USING (is_active = true OR public.get_current_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "管理员可管理分类" ON public.categories;
CREATE POLICY "管理员可管理分类"
  ON public.categories FOR ALL
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- 3. items
DROP POLICY IF EXISTS "管理员可新增样机" ON public.items;
CREATE POLICY "管理员可新增样机"
  ON public.items FOR INSERT
  WITH CHECK (public.get_current_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "管理员可更新样机" ON public.items;
CREATE POLICY "管理员可更新样机"
  ON public.items FOR UPDATE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "管理员可删除样机" ON public.items;
CREATE POLICY "管理员可删除样机"
  ON public.items FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- 4. approval_chains
DROP POLICY IF EXISTS "所有登录用户可查看审批链" ON public.approval_chains;
CREATE POLICY "所有登录用户可查看审批链"
  ON public.approval_chains FOR SELECT
  USING (is_active = true OR public.get_current_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "管理员可管理审批链" ON public.approval_chains;
CREATE POLICY "管理员可管理审批链"
  ON public.approval_chains FOR ALL
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- 5. approval_records
DROP POLICY IF EXISTS "相关人员可查看审批记录" ON public.approval_records;
CREATE POLICY "相关人员可查看审批记录"
  ON public.approval_records FOR SELECT
  USING (
    approver_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.borrow_requests br
      WHERE br.id = request_id AND br.requester_id = (select auth.uid())
    )
    OR public.get_current_user_role() IN ('admin', 'super_admin')
  );

-- 6. borrow_records
DROP POLICY IF EXISTS "借用人或管理员可查看借用记录" ON public.borrow_records;
CREATE POLICY "借用人或管理员可查看借用记录"
  ON public.borrow_records FOR SELECT
  USING (
    borrower_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'approver', 'super_admin')
  );

-- 7. stock_movements
DROP POLICY IF EXISTS "管理员可创建库存变动" ON public.stock_movements;
CREATE POLICY "管理员可创建库存变动"
  ON public.stock_movements FOR INSERT
  WITH CHECK (public.get_current_user_role() IN ('admin', 'super_admin'));
