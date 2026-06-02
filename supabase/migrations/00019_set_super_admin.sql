-- ===== 将指定用户设为超级管理员 =====
-- 用法：将下方占位符替换为实际的目标用户邮箱和 UID
-- 目标用户: <SUPER_ADMIN_EMAIL> (UID: <SUPER_ADMIN_UID>)

-- 1. 先将所有现有的 super_admin 降级为 admin（确保只有一个 super_admin）
UPDATE public.profiles
SET role = 'admin', updated_at = now()
WHERE role = 'super_admin'
  AND id != '<SUPER_ADMIN_UID>';

-- 2. 将目标用户设为 super_admin
UPDATE public.profiles
SET role = 'super_admin', status = 'active', updated_at = now()
WHERE id = '<SUPER_ADMIN_UID>';

-- 3. 如果目标用户不存在于 profiles 表，则插入（兜底）
INSERT INTO public.profiles (id, display_name, email, role, status, created_at, updated_at)
SELECT
  '<SUPER_ADMIN_UID>',
  '<SUPER_ADMIN_EMAIL>',
  '<SUPER_ADMIN_EMAIL>',
  'super_admin',
  'active',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE id = '<SUPER_ADMIN_UID>'
);
