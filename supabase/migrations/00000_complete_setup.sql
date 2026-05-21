-- ============================================================
-- DJI 样机管理系统 - 全量数据库迁移脚本
-- 在 Supabase SQL Editor 中一次性执行此文件即可
-- ============================================================

-- ===== 1. 用户档案表 =====
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  department TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'approver', 'user')),
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 自动创建 profile 的触发器
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== 2. 样机分类表 =====
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  icon_name TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== 3. 样机库存表 =====
CREATE TABLE public.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  serial_number TEXT,
  category_id UUID NOT NULL REFERENCES public.categories(id),
  status TEXT NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock', 'borrowed', 'overdue', 'maintenance', 'retired')),
  specs JSONB DEFAULT '{}',
  purchase_date DATE,
  purchase_price DECIMAL(10,2),
  notes TEXT,
  image_url TEXT,
  location TEXT,
  current_borrower_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_status ON public.items(status);
CREATE INDEX idx_items_category ON public.items(category_id);
CREATE INDEX idx_items_barcode ON public.items(barcode);

-- ===== 4. 借用申请表 =====
CREATE TABLE public.borrow_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT NOT NULL UNIQUE,
  requester_id UUID NOT NULL REFERENCES public.profiles(id),
  item_id UUID NOT NULL REFERENCES public.items(id),
  borrow_type TEXT NOT NULL CHECK (borrow_type IN ('customer', 'marketing')),
  purpose TEXT NOT NULL,
  customer_name TEXT,
  customer_contact TEXT,
  expected_borrow_date DATE NOT NULL,
  expected_return_date DATE NOT NULL,
  actual_borrow_date DATE,
  actual_return_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'partially_approved', 'rejected', 'cancelled',
                      'borrowed', 'returned', 'overdue', 'renewal_requested')),
  parent_request_id UUID REFERENCES public.borrow_requests(id),
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_borrow_requests_requester ON public.borrow_requests(requester_id);
CREATE INDEX idx_borrow_requests_item ON public.borrow_requests(item_id);
CREATE INDEX idx_borrow_requests_status ON public.borrow_requests(status);

-- ===== 5. 审批链配置表 =====
CREATE TABLE public.approval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  borrow_type TEXT NOT NULL CHECK (borrow_type IN ('customer', 'marketing', 'all')),
  steps JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.approval_chains.steps IS '审批步骤定义, 格式: [{"level":1, "type":"role", "role":"approver", "label":"销售主管审批"}, {"level":2, "type":"person", "user_id":"uuid", "label":"张总确认"}]';

-- ===== 6. 审批记录表 =====
CREATE TABLE public.approval_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.borrow_requests(id) ON DELETE CASCADE,
  chain_id UUID NOT NULL REFERENCES public.approval_chains(id),
  approver_id UUID NOT NULL REFERENCES public.profiles(id),
  step_level INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  comment TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_records_request ON public.approval_records(request_id);
CREATE INDEX idx_approval_records_approver ON public.approval_records(approver_id);

-- ===== 7. 借用记录表 =====
CREATE TABLE public.borrow_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.borrow_requests(id),
  item_id UUID NOT NULL REFERENCES public.items(id),
  borrower_id UUID NOT NULL REFERENCES public.profiles(id),
  borrow_type TEXT NOT NULL CHECK (borrow_type IN ('customer', 'marketing')),
  borrow_date DATE NOT NULL,
  due_date DATE NOT NULL,
  return_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'returned', 'overdue')),
  overdue_days INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_borrow_records_item ON public.borrow_records(item_id);
CREATE INDEX idx_borrow_records_borrower ON public.borrow_records(borrower_id);
CREATE INDEX idx_borrow_records_status ON public.borrow_records(status);
CREATE INDEX idx_borrow_records_due_date ON public.borrow_records(due_date);

-- ===== 8. 库存变动审计表 =====
CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.items(id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('borrow_out', 'return_in', 'new_entry', 'maintenance', 'retire')),
  borrow_record_id UUID REFERENCES public.borrow_records(id),
  operator_id UUID NOT NULL REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_item ON public.stock_movements(item_id);
CREATE INDEX idx_stock_movements_type ON public.stock_movements(movement_type);

-- ===== 9. 逾期通知表 =====
CREATE TABLE public.overdue_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_record_id UUID NOT NULL REFERENCES public.borrow_records(id),
  borrower_id UUID NOT NULL REFERENCES public.profiles(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN ('email', 'push', 'sms', 'wecom')),
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_read BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_overdue_notifications_borrower ON public.overdue_notifications(borrower_id);
CREATE INDEX idx_overdue_notifications_read ON public.overdue_notifications(is_read);

-- ===== 10. RLS 策略 =====

-- 辅助函数: 获取当前用户角色
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = (select auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- profiles
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

-- categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有人可查看活跃分类"
  ON public.categories FOR SELECT
  USING (is_active = true OR public.get_current_user_role() = 'admin');

CREATE POLICY "管理员可管理分类"
  ON public.categories FOR ALL
  USING (public.get_current_user_role() = 'admin');

-- items
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

-- borrow_requests
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

CREATE POLICY "申请人可取消自己的申请"
  ON public.borrow_requests FOR UPDATE
  USING (requester_id = (select auth.uid()) AND status = 'pending');

-- approval_chains
ALTER TABLE public.approval_chains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有登录用户可查看审批链"
  ON public.approval_chains FOR SELECT
  USING (is_active = true OR public.get_current_user_role() = 'admin');

CREATE POLICY "管理员可管理审批链"
  ON public.approval_chains FOR ALL
  USING (public.get_current_user_role() = 'admin');

-- approval_records
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

-- borrow_records
ALTER TABLE public.borrow_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "借用人或管理员可查看借用记录"
  ON public.borrow_records FOR SELECT
  USING (
    borrower_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'approver')
  );

-- stock_movements
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "所有登录用户可查看库存变动"
  ON public.stock_movements FOR SELECT
  USING (true);

CREATE POLICY "管理员可创建库存变动"
  ON public.stock_movements FOR INSERT
  WITH CHECK (public.get_current_user_role() = 'admin');

-- overdue_notifications
ALTER TABLE public.overdue_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户可查看自己的通知"
  ON public.overdue_notifications FOR SELECT
  USING (borrower_id = (select auth.uid()));

CREATE POLICY "用户可更新自己的通知为已读"
  ON public.overdue_notifications FOR UPDATE
  USING (borrower_id = (select auth.uid()));

-- ===== 11. 触发器 =====

-- 自动生成条码
CREATE SEQUENCE IF NOT EXISTS public.barcode_seq;

CREATE OR REPLACE FUNCTION public.generate_barcode()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.barcode IS NULL THEN
    NEW.barcode := 'DJI-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                   LPAD(nextval('public.barcode_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_barcode
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.generate_barcode();

-- 自动生成申请编号
CREATE SEQUENCE IF NOT EXISTS public.request_seq;

CREATE OR REPLACE FUNCTION public.generate_request_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.request_number IS NULL THEN
    NEW.request_number := 'BR-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                          LPAD(nextval('public.request_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_request_number
  BEFORE INSERT ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.generate_request_number();

-- 审批通过后自动创建借用记录 + 更新样机状态
CREATE OR REPLACE FUNCTION public.on_request_approved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    INSERT INTO public.borrow_records (
      request_id, item_id, borrower_id, borrow_type,
      borrow_date, due_date, status
    ) VALUES (
      NEW.id, NEW.item_id, NEW.requester_id, NEW.borrow_type,
      COALESCE(NEW.actual_borrow_date, CURRENT_DATE),
      NEW.expected_return_date,
      'active'
    );

    UPDATE public.items
    SET status = 'borrowed',
        current_borrower_id = NEW.requester_id,
        updated_at = now()
    WHERE id = NEW.item_id;

    INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
    VALUES (
      NEW.item_id, 'borrow_out', NEW.requester_id,
      '申请编号: ' || NEW.request_number
    );

    UPDATE public.borrow_requests
    SET actual_borrow_date = CURRENT_DATE, status = 'borrowed', updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_request_approved
  AFTER UPDATE ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.on_request_approved();

-- 归还后自动更新样机状态
CREATE OR REPLACE FUNCTION public.on_borrow_returned()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'returned' AND (OLD.status IS NULL OR OLD.status != 'returned') THEN
    UPDATE public.items
    SET status = 'in_stock',
        current_borrower_id = NULL,
        updated_at = now()
    WHERE id = NEW.item_id;

    INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
    VALUES (
      NEW.item_id, 'return_in', NEW.borrower_id,
      '归还, 借用记录ID: ' || NEW.id
    );

    UPDATE public.borrow_requests
    SET status = 'returned',
        actual_return_date = CURRENT_DATE,
        updated_at = now()
    WHERE id = NEW.request_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_borrow_returned
  AFTER UPDATE ON public.borrow_records
  FOR EACH ROW EXECUTE FUNCTION public.on_borrow_returned();

-- 逾期状态自动更新
CREATE OR REPLACE FUNCTION public.check_overdue_status()
RETURNS void AS $$
BEGIN
  UPDATE public.borrow_records
  SET status = 'overdue',
      overdue_days = CURRENT_DATE - due_date,
      updated_at = now()
  WHERE status = 'active' AND due_date < CURRENT_DATE;

  UPDATE public.items i
  SET status = 'overdue', updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.borrow_records br
    WHERE br.item_id = i.id AND br.status = 'overdue'
  );

  UPDATE public.borrow_requests br
  SET status = 'overdue', updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.borrow_records brec
    WHERE brec.request_id = br.id AND brec.status = 'overdue'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- updated_at 自动更新
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_borrow_requests_updated_at
  BEFORE UPDATE ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_borrow_records_updated_at
  BEFORE UPDATE ON public.borrow_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_approval_chains_updated_at
  BEFORE UPDATE ON public.approval_chains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ===== 12. 私有函数 (SECURITY DEFINER) =====

CREATE SCHEMA IF NOT EXISTS private;

-- 审批操作
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
  SELECT chain_id, step_level INTO v_chain_id, v_step_level
  FROM public.approval_records
  WHERE request_id = p_request_id AND approver_id = (select auth.uid()) AND acted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION '没有找到待您审批的记录';
  END IF;

  UPDATE public.approval_records
  SET action = p_action, comment = p_comment, acted_at = now()
  WHERE request_id = p_request_id AND approver_id = (select auth.uid()) AND acted_at IS NULL;

  IF p_action = 'rejected' THEN
    UPDATE public.borrow_requests SET status = 'rejected', rejection_reason = p_comment, updated_at = now()
    WHERE id = p_request_id;
  ELSE
    SELECT COUNT(*) INTO v_acted_count
    FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NOT NULL;

    SELECT jsonb_array_length(steps) INTO v_total_steps
    FROM public.approval_chains WHERE id = v_chain_id;

    IF v_acted_count >= v_total_steps THEN
      UPDATE public.borrow_requests SET status = 'approved', updated_at = now()
      WHERE id = p_request_id;
    ELSE
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
  INSERT INTO public.borrow_requests (
    requester_id, item_id, borrow_type, purpose,
    customer_name, customer_contact,
    expected_borrow_date, expected_return_date, status
  ) VALUES (
    p_requester_id, p_item_id, p_borrow_type, p_purpose,
    p_customer_name, p_customer_contact,
    p_expected_borrow_date, p_expected_return_date, 'pending'
  ) RETURNING id INTO v_request_id;

  SELECT id, steps INTO v_chain_id, v_chain_steps
  FROM public.approval_chains
  WHERE borrow_type IN (p_borrow_type, 'all') AND is_active = true
  ORDER BY borrow_type DESC LIMIT 1;

  IF v_chain_id IS NULL THEN
    UPDATE public.borrow_requests SET status = 'approved', updated_at = now()
    WHERE id = v_request_id;
    RETURN v_request_id;
  END IF;

  FOR i IN 0..jsonb_array_length(v_chain_steps) - 1 LOOP
    v_step := v_chain_steps->i;

    DECLARE
      v_approver_id UUID;
    BEGIN
      IF (v_step->>'type') = 'person' THEN
        v_approver_id := ((v_step->>'user_id'))::UUID;
      ELSE
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

-- ===== 13. 种子数据 =====

-- 分类
INSERT INTO public.categories (name, code, description, icon_name, sort_order) VALUES
  ('无人机', 'DRONE', 'DJI 无人机系列产品', 'Plane', 1),
  ('云台相机', 'GIMBAL_CAMERA', 'DJI 云台及相机产品', 'Camera', 2),
  ('手持云台', 'GIMBAL', 'DJI 手持稳定器', 'Smartphone', 3),
  ('配件', 'ACCESSORY', '电池、充电器、螺旋桨等配件', 'Package', 4),
  ('行业应用', 'ENTERPRISE', '行业应用产品', 'Building2', 5);

-- 默认审批链
INSERT INTO public.approval_chains (name, borrow_type, steps) VALUES
  ('客户借用审批', 'customer', '[
    {"level": 1, "type": "role", "role": "approver", "label": "销售主管审批"},
    {"level": 2, "type": "role", "role": "admin", "label": "管理员确认"}
  ]'::jsonb),
  ('营销演示审批', 'marketing', '[
    {"level": 1, "type": "role", "role": "approver", "label": "销售主管审批"}
  ]'::jsonb);
