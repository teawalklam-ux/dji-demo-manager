-- ===== 注册预检：检查邮箱是否已存在 =====
-- SECURITY DEFINER 函数，绕过 RLS 查询所有状态的 profile
-- 防止已注册（含 pending_approval / disabled）邮箱被重复注册

CREATE OR REPLACE FUNCTION public.check_email_exists(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE email ILIKE p_email
  );
$$;
