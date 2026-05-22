-- 1. profiles 表新增 status 字段
ALTER TABLE public.profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('pending_approval', 'active', 'disabled'));

-- 2. 迁移现有 is_active 数据到 status
UPDATE public.profiles SET status = CASE
  WHEN is_active = true THEN 'active'
  ELSE 'disabled'
END;

-- 3. 修改 handle_new_user() 触发器：自注册 → pending_approval，管理员邀请 → active
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
    -- 如果带 invite_by_admin 标记，直接 active；否则 pending_approval
    CASE
      WHEN (NEW.raw_user_meta_data->>'invite_by_admin') = 'true' THEN 'active'
      ELSE 'pending_approval'
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 审批用户（通过）
CREATE OR REPLACE FUNCTION private.approve_user(p_user_id UUID)
RETURNS void AS $$
BEGIN
  -- 验证调用者是管理员
  IF public.get_current_user_role() != 'admin' THEN
    RAISE EXCEPTION '仅管理员可审批用户';
  END IF;

  UPDATE public.profiles
  SET status = 'active', updated_at = now()
  WHERE id = p_user_id AND status = 'pending_approval';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 拒绝用户
CREATE OR REPLACE FUNCTION private.reject_user(p_user_id UUID)
RETURNS void AS $$
BEGIN
  -- 验证调用者是管理员
  IF public.get_current_user_role() != 'admin' THEN
    RAISE EXCEPTION '仅管理员可拒绝用户';
  END IF;

  -- 拒绝：将 profile 状态设为 disabled，同时删除 auth.users（阻止登录）
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 更新 RLS 策略 - 删除旧的，创建新的
DROP POLICY IF EXISTS "用户可查看所有活跃用户" ON public.profiles;

-- 6a. 用户可查看自己的 profile（不管什么状态）
CREATE POLICY "用户可查看自己的资料"
  ON public.profiles FOR SELECT
  USING (id = (select auth.uid()));

-- 6b. 可查看活跃用户（供选择审批人等场景）
CREATE POLICY "可查看活跃用户"
  ON public.profiles FOR SELECT
  USING (status = 'active');

-- 6c. 管理员可查看所有用户
CREATE POLICY "管理员可查看所有用户"
  ON public.profiles FOR SELECT
  USING (public.get_current_user_role() = 'admin');

-- 6d. 管理员可插入用户 profile（用于特殊场景）
CREATE POLICY "管理员可插入用户"
  ON public.profiles FOR INSERT
  WITH CHECK (public.get_current_user_role() = 'admin');

-- 7. 更新 create_borrow_request() 中 is_active → status='active'
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
        WHERE role = v_step->>'role' AND status = 'active'
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
