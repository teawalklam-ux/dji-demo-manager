-- ===== 超级管理员角色 =====

-- 1. 扩展 profiles.role CHECK 约束，增加 super_admin
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'approver', 'user'));

-- 2. 将现有 admin 用户提升为 super_admin
UPDATE public.profiles SET role = 'super_admin' WHERE role = 'admin';

-- 3. 保护 super_admin：非 super_admin 不能修改 super_admin 的记录
-- 先删除旧的策略
DROP POLICY IF EXISTS "管理员可更新任何用户" ON public.profiles;

-- 重新创建：super_admin 可修改任何人，admin 只能修改非 super_admin
CREATE POLICY "管理员可更新非超管用户"
  ON public.profiles FOR UPDATE
  USING (
    public.get_current_user_role() = 'super_admin'
    OR (
      public.get_current_user_role() = 'admin'
      AND role != 'super_admin'
    )
  );

-- 4. 保护 super_admin：非 super_admin 不能删除 super_admin
-- (profiles 用 ON DELETE CASCADE 跟随 auth.users，此处主要是 INSERT 保护)
DROP POLICY IF EXISTS "管理员可插入用户" ON public.profiles;
CREATE POLICY "管理员可插入用户"
  ON public.profiles FOR INSERT
  WITH CHECK (
    public.get_current_user_role() IN ('admin', 'super_admin')
  );

-- 5. 转移超级管理员权限函数
CREATE OR REPLACE FUNCTION public.transfer_super_admin(
  p_new_super_admin_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_current_super_id UUID;
BEGIN
  -- 获取当前 super_admin
  SELECT id INTO v_current_super_id FROM public.profiles WHERE role = 'super_admin';

  -- 只有当前 super_admin 才能执行转移
  IF auth.uid() != v_current_super_id THEN
    RAISE EXCEPTION '只有超级管理员才能转移权限';
  END IF;

  -- 目标用户必须是 admin 角色
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_new_super_admin_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION '目标用户必须是管理员';
  END IF;

  -- 转移：当前 super_admin → admin，目标 → super_admin
  UPDATE public.profiles SET role = 'admin', updated_at = now() WHERE id = v_current_super_id;
  UPDATE public.profiles SET role = 'super_admin', updated_at = now() WHERE id = p_new_super_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 更新审批/删除相关 RLS：admin + super_admin 都能操作
-- borrow_requests
DROP POLICY IF EXISTS "管理员可删除借用申请" ON public.borrow_requests;
CREATE POLICY "管理员可删除借用申请"
  ON public.borrow_requests FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- approval_records
DROP POLICY IF EXISTS "管理员可删除审批记录" ON public.approval_records;
CREATE POLICY "管理员可删除审批记录"
  ON public.approval_records FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- borrow_records
DROP POLICY IF EXISTS "管理员可删除借用记录" ON public.borrow_records;
CREATE POLICY "管理员可删除借用记录"
  ON public.borrow_records FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- stock_movements
DROP POLICY IF EXISTS "管理员可删除库存变动记录" ON public.stock_movements;
CREATE POLICY "管理员可删除库存变动记录"
  ON public.stock_movements FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- overdue_notifications
DROP POLICY IF EXISTS "管理员可删除逾期通知" ON public.overdue_notifications;
CREATE POLICY "管理员可删除逾期通知"
  ON public.overdue_notifications FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- 管理员查看相关策略也扩展
DROP POLICY IF EXISTS "管理员可查看所有用户" ON public.profiles;
CREATE POLICY "管理员可查看所有用户"
  ON public.profiles FOR SELECT
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));
