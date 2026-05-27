-- 将 create_borrow_request 从 private 移到 public schema
-- Supabase rpc() 只能调用 public schema 的函数

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

-- 将 process_return 从 private 移到 public schema
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

  -- 更新样机状态为在库
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
