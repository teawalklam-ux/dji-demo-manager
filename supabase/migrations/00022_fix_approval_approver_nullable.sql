-- 修复 create_borrow_request：按角色找不到审批人时回退到 admin/super_admin
-- 同时 approval_records.approver_id 改为可空，避免找不到审批人时插入失败

-- 1. approver_id 改为可空
ALTER TABLE public.approval_records ALTER COLUMN approver_id DROP NOT NULL;

-- 2. 重新创建函数，添加回退逻辑
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
