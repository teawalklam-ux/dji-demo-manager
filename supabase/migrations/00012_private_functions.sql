-- 私有函数 (SECURITY DEFINER), 放在 private schema 中

CREATE SCHEMA IF NOT EXISTS private;

-- 审批操作: 验证当前审批人权限并记录审批
CREATE OR REPLACE FUNCTION private.process_approval(
  p_request_id UUID,
  p_action TEXT,
  p_comment TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_chain_id UUID;
  v_step_level INT;
  v_record_id UUID;
  v_acted_count INT;
  v_total_steps INT;
BEGIN
  -- 获取该请求对应的审批链和当前步骤
  SELECT chain_id, step_level INTO v_chain_id, v_step_level
  FROM public.approval_records
  WHERE request_id = p_request_id AND approver_id = (select auth.uid()) AND acted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION '没有找到待您审批的记录';
  END IF;

  -- 记录审批动作
  UPDATE public.approval_records
  SET action = p_action, comment = p_comment, acted_at = now()
  WHERE request_id = p_request_id AND approver_id = (select auth.uid()) AND acted_at IS NULL;

  IF p_action = 'rejected' THEN
    UPDATE public.borrow_requests SET status = 'rejected', rejection_reason = p_comment, updated_at = now()
    WHERE id = p_request_id;
  ELSE
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

-- 处理归还操作
CREATE OR REPLACE FUNCTION private.process_return(
  p_borrow_record_id UUID,
  p_operator_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE public.borrow_records
  SET status = 'returned',
      return_date = CURRENT_DATE,
      notes = COALESCE(p_notes, notes),
      updated_at = now()
  WHERE id = p_borrow_record_id
    AND (borrower_id = (select auth.uid()) OR p_operator_id IS NOT NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建借用申请并自动生成审批记录
CREATE OR REPLACE FUNCTION private.create_borrow_request(
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

    DECLARE
      v_approver_id UUID;
    BEGIN
      IF (v_step->>'type') = 'person' THEN
        v_approver_id := ((v_step->>'user_id'))::UUID;
      ELSE
        -- 按角色查找: 取该角色中第一个活跃用户
        SELECT id INTO v_approver_id
        FROM public.profiles
        WHERE role = v_step->>'role' AND is_active = true
        LIMIT 1;
      END IF;

      IF v_approver_id IS NOT NULL THEN
        INSERT INTO public.approval_records (
          request_id, chain_id, approver_id, step_level
        ) VALUES (
          v_request_id, v_chain_id, v_approver_id,
          ((v_step->>'level'))::INT
        );
      END IF;
    END;
  END LOOP;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
