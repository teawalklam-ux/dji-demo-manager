-- ===== 修复 profiles 表 RLS：super_admin 无法查看用户列表 =====
-- 问题：RLS 策略只检查 = 'admin'，super_admin 登录时查不到任何用户
-- 原因：迁移 00018 未在 Supabase 执行

-- 1. SELECT：admin + super_admin 都可查看所有用户
DROP POLICY IF EXISTS "管理员可查看所有用户" ON public.profiles;
CREATE POLICY "管理员可查看所有用户"
  ON public.profiles FOR SELECT
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- 2. UPDATE：super_admin 可改任何人，admin 只能改非 super_admin
DROP POLICY IF EXISTS "管理员可更新任何用户" ON public.profiles;
DROP POLICY IF EXISTS "管理员可更新非超管用户" ON public.profiles;
CREATE POLICY "管理员可更新任何用户"
  ON public.profiles FOR UPDATE
  USING (
    public.get_current_user_role() = 'super_admin'
    OR (
      public.get_current_user_role() = 'admin'
      AND role != 'super_admin'
    )
  );

-- 3. INSERT：admin + super_admin 都可插入
DROP POLICY IF EXISTS "管理员可插入用户" ON public.profiles;
CREATE POLICY "管理员可插入用户"
  ON public.profiles FOR INSERT
  WITH CHECK (public.get_current_user_role() IN ('admin', 'super_admin'));
