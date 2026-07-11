-- 修复 create_borrow_request 函数中 array_lower/array_upper 缺少维度参数的 bug
-- 错误: function array_lower(uuid[]) does not exist
-- 原因: PostgreSQL 中 array_lower(anyarray, int) 需要第二个参数指定维度(1=第一维)
-- PL/pgSQL 是解释型语言, 函数创建时不检查函数体, 运行到该行才报错, 导致整个事务回滚(申请创建失败)

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
  v_request_number TEXT;
  v_chain_id UUID;
  v_chain_steps JSONB;
  v_step JSONB;
  v_approver_id UUID;
  v_approver_ids UUID[];
  v_requester_name TEXT;
  v_item_name TEXT;
  v_item_model TEXT;
  v_borrow_type_label TEXT;
  v_notif_message TEXT;
  v_recipient RECORD;
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
  ) RETURNING id, request_number INTO v_request_id, v_request_number;

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
  v_approver_ids := ARRAY[]::UUID[];
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

    -- 收集审批人ID（去重）
    IF v_approver_id IS NOT NULL AND NOT (v_approver_id = ANY(v_approver_ids)) THEN
      v_approver_ids := array_append(v_approver_ids, v_approver_id);
    END IF;

    -- 插入审批记录
    INSERT INTO public.approval_records (
      request_id, chain_id, approver_id, step_level
    ) VALUES (
      v_request_id, v_chain_id, v_approver_id,
      ((v_step->>'level'))::INT
    );
  END LOOP;

  -- ===== 审批通知逻辑 =====

  -- 获取申请人名称
  SELECT display_name INTO v_requester_name
  FROM public.profiles WHERE id = p_requester_id;

  -- 获取样机名称
  SELECT name, model INTO v_item_name, v_item_model
  FROM public.items WHERE id = p_item_id;

  -- 借用类型标签
  v_borrow_type_label := CASE p_borrow_type
    WHEN 'customer' THEN '客户试用'
    WHEN 'marketing' THEN '营销演示'
    ELSE p_borrow_type
  END;

  -- 构造通知消息
  v_notif_message := format(
    '新审批申请：%s 申请借用「%s」（%s），借用类型：%s，借用日期：%s ~ %s',
    COALESCE(v_requester_name, '未知用户'),
    COALESCE(v_item_name, '未知样机'),
    COALESCE(v_item_model, ''),
    v_borrow_type_label,
    p_expected_borrow_date::TEXT,
    p_expected_return_date::TEXT
  );

  -- 1) 向审批链中确定的审批人发送站内通知
  -- 修复: array_lower/array_upper 需要第二个参数(维度=1); 空数组返回 NULL 时 FOR 循环不执行
  FOR i IN array_lower(v_approver_ids, 1) .. array_upper(v_approver_ids, 1) LOOP
    INSERT INTO public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type,
      notification_category, recipient_id, borrow_request_id,
      message, is_read
    ) VALUES (
      NULL, p_requester_id, 'push',
      'approval', v_approver_ids[i], v_request_id,
      v_notif_message, false
    );
  END LOOP;

  -- 2) 向所有 super_admin 和 admin 角色的活跃用户发送站内通知（管理员有权审批所有流程）
  FOR v_recipient IN
    SELECT id FROM public.profiles
    WHERE role IN ('super_admin', 'admin')
      AND is_active = true
      AND id != p_requester_id  -- 不通知自己
      AND NOT (id = ANY(v_approver_ids))  -- 避免重复通知
  LOOP
    INSERT INTO public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type,
      notification_category, recipient_id, borrow_request_id,
      message, is_read
    ) VALUES (
      NULL, p_requester_id, 'push',
      'approval', v_recipient.id, v_request_id,
      v_notif_message, false
    );
  END LOOP;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
