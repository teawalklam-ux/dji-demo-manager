-- ===== 综合修复脚本 =====
-- 包含 00016、00020、00021、00022 的所有修复
-- 请在 Supabase SQL Editor 中一次性执行

-- ============================================================
-- 第一部分：borrow_requests SELECT RLS 补充 super_admin
-- ============================================================
DROP POLICY IF EXISTS "用户可查看自己的申请" ON public.borrow_requests;
CREATE POLICY "用户可查看自己的申请"
  ON public.borrow_requests FOR SELECT
  USING (
    requester_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'approver', 'super_admin')
  );

-- ============================================================
-- 第二部分：修复所有表的 RLS 策略（00020）
-- ============================================================

-- categories
DROP POLICY IF EXISTS "所有人可查看活跃分类" ON public.categories;
CREATE POLICY "所有人可查看活跃分类"
  ON public.categories FOR SELECT
  USING (is_active = true OR public.get_current_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "管理员可管理分类" ON public.categories;
CREATE POLICY "管理员可管理分类"
  ON public.categories FOR ALL
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- items
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

-- approval_chains
DROP POLICY IF EXISTS "所有登录用户可查看审批链" ON public.approval_chains;
CREATE POLICY "所有登录用户可查看审批链"
  ON public.approval_chains FOR SELECT
  USING (is_active = true OR public.get_current_user_role() IN ('admin', 'super_admin'));

DROP POLICY IF EXISTS "管理员可管理审批链" ON public.approval_chains;
CREATE POLICY "管理员可管理审批链"
  ON public.approval_chains FOR ALL
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- approval_records
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

-- borrow_records
DROP POLICY IF EXISTS "借用人或管理员可查看借用记录" ON public.borrow_records;
CREATE POLICY "借用人或管理员可查看借用记录"
  ON public.borrow_records FOR SELECT
  USING (
    borrower_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'approver', 'super_admin')
  );

-- stock_movements
DROP POLICY IF EXISTS "管理员可创建库存变动" ON public.stock_movements;
CREATE POLICY "管理员可创建库存变动"
  ON public.stock_movements FOR INSERT
  WITH CHECK (public.get_current_user_role() IN ('admin', 'super_admin'));

-- borrow_requests DELETE
DROP POLICY IF EXISTS "管理员可删除借用申请" ON public.borrow_requests;
CREATE POLICY "管理员可删除借用申请"
  ON public.borrow_requests FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- approval_records DELETE
DROP POLICY IF EXISTS "管理员可删除审批记录" ON public.approval_records;
CREATE POLICY "管理员可删除审批记录"
  ON public.approval_records FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- ============================================================
-- 第三部分：approval_records.approver_id 改为可空（00022）
-- ============================================================
ALTER TABLE public.approval_records ALTER COLUMN approver_id DROP NOT NULL;

-- ============================================================
-- 第四部分：create_borrow_request 修复（00016 + 00022 合并）
-- - 移到 public schema
-- - is_active 替代 status
-- - 角色查找回退逻辑
-- - approver_id 允许 NULL
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_borrow_request(
  p_requester_id UUID,
  p_item_id UUID,
  p_borrow_type TEXT,
  p_purpose TEXT,
  p_expected_borrow_date DATE,
  p_expected_return_date DATE,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_contact TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_request_id UUID;
  v_chain_id UUID;
  v_chain_steps JSONB;
  v_step JSONB;
  v_approver_id UUID;
BEGIN
  -- 创建借用申请
  INSERT INTO public.borrow_requests (
    requester_id, item_id, borrow_type, purpose,
    customer_name, customer_contact,
    expected_borrow_date, expected_return_date, status
  ) VALUES (
    p_requester_id, p_item_id, p_borrow_type, p_purpose,
    p_customer_name, p_customer_contact,
    p_expected_borrow_date, p_expected_return_date, 'pending'
  ) RETURNING id INTO v_request_id;

  -- 查找对应的审批链
  SELECT id, steps INTO v_chain_id, v_chain_steps
  FROM public.approval_chains
  WHERE borrow_type IN (p_borrow_type, 'all') AND is_active = true
  ORDER BY borrow_type DESC LIMIT 1;

  IF v_chain_id IS NULL THEN
    -- 没有审批链, 直接通过
    UPDATE public.borrow_requests SET status = 'approved', updated_at = now()
    WHERE id = v_request_id;
    RETURN v_request_id;
  END IF;

  -- 为每一步创建审批记录
  FOR i IN 0..jsonb_array_length(v_chain_steps) - 1 LOOP
    v_step := v_chain_steps->i;
    v_approver_id := NULL;

    IF (v_step->>'type') = 'person' THEN
      -- 按指定人员
      v_approver_id := ((v_step->>'user_id'))::UUID;
    ELSE
      -- 按角色查找: 取该角色中第一个活跃用户
      SELECT id INTO v_approver_id
      FROM public.profiles
      WHERE role = v_step->>'role' AND is_active = true
      LIMIT 1;

      -- 如果指定角色找不到人，回退到 super_admin
      IF v_approver_id IS NULL THEN
        SELECT id INTO v_approver_id
        FROM public.profiles
        WHERE role = 'super_admin' AND is_active = true
        LIMIT 1;
      END IF;

      -- 如果 super_admin 也没有，回退到 admin
      IF v_approver_id IS NULL THEN
        SELECT id INTO v_approver_id
        FROM public.profiles
        WHERE role = 'admin' AND is_active = true
        LIMIT 1;
      END IF;
    END IF;

    -- 插入审批记录（approver_id 可能为 NULL，由管理员后续处理）
    INSERT INTO public.approval_records (
      request_id, chain_id, approver_id, step_level
    ) VALUES (
      v_request_id, v_chain_id, v_approver_id,
      ((v_step->>'level'))::INT
    );
  END LOOP;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 第五部分：process_approval 移到 public + super_admin/admin 批量审批（00021）
-- ============================================================

-- 先删除旧的三参数版本（避免函数歧义）
DROP FUNCTION IF EXISTS public.process_approval(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS private.process_approval(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.process_approval(
  p_request_id UUID,
  p_action TEXT,
  p_comment TEXT DEFAULT NULL,
  p_approver_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_chain_id UUID;
  v_step_level INT;
  v_record_id UUID;
  v_acted_count INT;
  v_total_steps INT;
  v_approver_id UUID;
  v_approver_role TEXT;
BEGIN
  -- 确定审批人ID
  v_approver_id := COALESCE(p_approver_id, auth.uid());

  -- 获取审批人角色
  SELECT role INTO v_approver_role FROM public.profiles WHERE id = v_approver_id;

  -- 查找该请求对应的待审批记录
  IF v_approver_role IN ('super_admin', 'admin') THEN
    -- super_admin/admin 可以审批任何未审批的记录
    SELECT id, chain_id, step_level INTO v_record_id, v_chain_id, v_step_level
    FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NULL
    ORDER BY step_level ASC
    LIMIT 1;
  ELSE
    -- 其他角色只能审批自己负责的记录
    SELECT id, chain_id, step_level INTO v_record_id, v_chain_id, v_step_level
    FROM public.approval_records
    WHERE request_id = p_request_id AND approver_id = v_approver_id AND acted_at IS NULL
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '没有找到待您审批的记录';
  END IF;

  -- 记录审批动作
  UPDATE public.approval_records
  SET action = p_action,
      comment = p_comment,
      acted_at = now(),
      approver_id = v_approver_id
  WHERE id = v_record_id;

  IF p_action = 'rejected' THEN
    UPDATE public.borrow_requests SET status = 'rejected', rejection_reason = p_comment, updated_at = now()
    WHERE id = p_request_id;
  ELSE
    -- super_admin/admin 代理审批时，一次性通过所有剩余步骤
    IF v_approver_role IN ('super_admin', 'admin') THEN
      UPDATE public.approval_records
      SET action = 'approved', acted_at = now(), approver_id = v_approver_id
      WHERE request_id = p_request_id AND acted_at IS NULL;
    END IF;

    -- 检查是否还有未审批的步骤
    SELECT COUNT(*) INTO v_acted_count
    FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NOT NULL;

    SELECT jsonb_array_length(steps) INTO v_total_steps
    FROM public.approval_chains WHERE id = v_chain_id;

    IF v_acted_count >= v_total_steps THEN
      -- 所有步骤已审批通过
      UPDATE public.borrow_requests SET status = 'approved', updated_at = now()
      WHERE id = p_request_id;
    ELSE
      -- 还有后续步骤
      UPDATE public.borrow_requests SET status = 'partially_approved', updated_at = now()
      WHERE id = p_request_id;
    END IF;
  END IF;

  RETURN v_record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 第六部分：process_return 移到 public schema（00016）
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_return(
  p_borrow_record_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_item_id UUID;
  v_borrower_id UUID;
BEGIN
  -- 获取借用记录信息
  SELECT item_id, borrower_id INTO v_item_id, v_borrower_id
  FROM public.borrow_records
  WHERE id = p_borrow_record_id;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION '借用记录不存在';
  END IF;

  -- 更新借用记录状态
  UPDATE public.borrow_records
  SET status = 'returned',
      return_date = CURRENT_DATE,
      notes = COALESCE(p_notes, notes),
      updated_at = now()
  WHERE id = p_borrow_record_id;

  -- 更新样机状态为在库（由触发器 on_borrow_returned 自动完成，但这里也显式执行以确保）
  UPDATE public.items
  SET status = 'in_stock',
      current_borrower_id = NULL,
      updated_at = now()
  WHERE id = v_item_id;

  -- 记录库存变动
  INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
  VALUES (v_item_id, 'return_in', v_borrower_id, COALESCE(p_notes, '归还样机'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 删除 private schema 中的旧函数
DROP FUNCTION IF EXISTS private.create_borrow_request(UUID, UUID, TEXT, TEXT, DATE, DATE, TEXT, TEXT);
DROP FUNCTION IF EXISTS private.process_return(UUID, TEXT);
DROP FUNCTION IF EXISTS private.process_approval(UUID, TEXT, TEXT);

-- ============================================================
-- 第七部分：确认触发器 on_request_approved 正确存在
-- 审批通过后自动创建 borrow_records + 更新样机状态
-- ============================================================
CREATE OR REPLACE FUNCTION public.on_request_approved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    -- 创建借用记录
    INSERT INTO public.borrow_records (
      request_id, item_id, borrower_id, borrow_type,
      borrow_date, due_date, status
    ) VALUES (
      NEW.id, NEW.item_id, NEW.requester_id, NEW.borrow_type,
      COALESCE(NEW.actual_borrow_date, CURRENT_DATE),
      NEW.expected_return_date,
      'active'
    );

    -- 更新样机状态为借用中
    UPDATE public.items
    SET status = 'borrowed',
        current_borrower_id = NEW.requester_id,
        updated_at = now()
    WHERE id = NEW.item_id;

    -- 记录库存变动
    INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
    VALUES (
      NEW.item_id, 'borrow_out', NEW.requester_id,
      '申请编号: ' || NEW.request_number
    );

    -- 更新申请的实际借用日期 + 状态变为 borrowed
    UPDATE public.borrow_requests
    SET actual_borrow_date = CURRENT_DATE, status = 'borrowed', updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 确保触发器存在
DROP TRIGGER IF EXISTS trg_on_request_approved ON public.borrow_requests;
CREATE TRIGGER trg_on_request_approved
  AFTER UPDATE ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.on_request_approved();

-- 完成提示
SELECT 'All fixes applied successfully!' AS result;
