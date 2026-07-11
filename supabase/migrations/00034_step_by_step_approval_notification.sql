-- 逐步审批通知：上一步审批完成后才推送下一步审批提醒
-- 1. create_borrow_request: 只给第一步审批人发站内通知（不再群发所有 admin/super_admin）
-- 2. process_approval: 审批通过后给下一步审批人发通知；全部通过后给申请人发"审批通过"通知
-- 3. notify-approval Edge Function 去重逻辑改为 borrow_request_id + recipient_id（在函数端改）

-- =====================================================================
-- 1. 修改 create_borrow_request：只通知第一步审批人
-- =====================================================================
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
  v_first_approver_id UUID;  -- 第一步审批人（step_level 最小）
  v_first_step_level INT;
  v_requester_name TEXT;
  v_item_name TEXT;
  v_item_model TEXT;
  v_borrow_type_label TEXT;
  v_notif_message TEXT;
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
  v_first_approver_id := NULL;
  v_first_step_level := 999999;
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

    -- 记录第一步审批人（step_level 最小的）
    IF v_approver_id IS NOT NULL AND ((v_step->>'level')::INT) < v_first_step_level THEN
      v_first_approver_id := v_approver_id;
      v_first_step_level := ((v_step->>'level')::INT);
    END IF;

    -- 插入审批记录
    INSERT INTO public.approval_records (
      request_id, chain_id, approver_id, step_level
    ) VALUES (
      v_request_id, v_chain_id, v_approver_id,
      ((v_step->>'level'))::INT
    );
  END LOOP;

  -- ===== 审批通知逻辑：只通知第一步审批人 =====

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

  -- 只给第一步审批人发站内通知（不再群发所有 admin/super_admin）
  IF v_first_approver_id IS NOT NULL THEN
    INSERT INTO public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type,
      notification_category, recipient_id, borrow_request_id,
      message, is_read
    ) VALUES (
      NULL, p_requester_id, 'push',
      'approval', v_first_approver_id, v_request_id,
      v_notif_message, false
    );
  END IF;

  RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================================
-- 2. 修改 process_approval：审批通过后通知下一步审批人 / 全部通过后通知申请人
-- =====================================================================
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
  v_next_approver_id UUID;
  v_requester_id UUID;
  v_requester_name TEXT;
  v_item_name TEXT;
  v_item_model TEXT;
  v_borrow_type TEXT;
  v_borrow_type_label TEXT;
  v_request_number TEXT;
  v_notif_message TEXT;
  v_item_id UUID;
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

  -- 获取申请信息（用于构造通知消息）
  SELECT requester_id, borrow_type, request_number, item_id
  INTO v_requester_id, v_borrow_type, v_request_number, v_item_id
  FROM public.borrow_requests WHERE id = p_request_id;

  SELECT display_name INTO v_requester_name
  FROM public.profiles WHERE id = v_requester_id;

  SELECT name, model INTO v_item_name, v_item_model
  FROM public.items WHERE id = v_item_id;

  v_borrow_type_label := CASE v_borrow_type
    WHEN 'customer' THEN '客户试用'
    WHEN 'marketing' THEN '营销演示'
    ELSE v_borrow_type
  END;

  IF p_action = 'rejected' THEN
    UPDATE public.borrow_requests SET status = 'rejected', rejection_reason = p_comment, updated_at = now()
    WHERE id = p_request_id;

    -- 通知申请人：审批被拒绝
    v_notif_message := format(
      '审批拒绝：您申请借用「%s」（%s）已被拒绝，单号：%s',
      COALESCE(v_item_name, '未知样机'),
      COALESCE(v_item_model, ''),
      v_request_number
    );
    INSERT INTO public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type,
      notification_category, recipient_id, borrow_request_id,
      message, is_read
    ) VALUES (
      NULL, v_requester_id, 'push',
      'approval', v_requester_id, p_request_id,
      v_notif_message, false
    );
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

      -- 通知申请人：审批全部通过
      v_notif_message := format(
        '审批通过：您申请借用「%s」（%s）已全部审批通过，单号：%s，请前往领取样机',
        COALESCE(v_item_name, '未知样机'),
        COALESCE(v_item_model, ''),
        v_request_number
      );
      INSERT INTO public.overdue_notifications (
        borrow_record_id, borrower_id, notification_type,
        notification_category, recipient_id, borrow_request_id,
        message, is_read
      ) VALUES (
        NULL, v_requester_id, 'push',
        'approval', v_requester_id, p_request_id,
        v_notif_message, false
      );
    ELSE
      -- 还有后续步骤：通知下一步审批人
      UPDATE public.borrow_requests SET status = 'partially_approved', updated_at = now()
      WHERE id = p_request_id;

      -- 查找下一步审批人
      SELECT approver_id INTO v_next_approver_id
      FROM public.approval_records
      WHERE request_id = p_request_id AND acted_at IS NULL
      ORDER BY step_level ASC
      LIMIT 1;

      IF v_next_approver_id IS NOT NULL THEN
        v_notif_message := format(
          '新审批申请：%s 申请借用「%s」（%s），借用类型：%s，单号：%s',
          COALESCE(v_requester_name, '未知用户'),
          COALESCE(v_item_name, '未知样机'),
          COALESCE(v_item_model, ''),
          v_borrow_type_label,
          v_request_number
        );
        INSERT INTO public.overdue_notifications (
          borrow_record_id, borrower_id, notification_type,
          notification_category, recipient_id, borrow_request_id,
          message, is_read
        ) VALUES (
          NULL, v_requester_id, 'push',
          'approval', v_next_approver_id, p_request_id,
          v_notif_message, false
        );
      END IF;
    END IF;
  END IF;

  RETURN v_record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
