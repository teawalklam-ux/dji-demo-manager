-- ===== 将指定用户设为超级管理员 =====
-- 目标用户: 366348802@qq.com (UID: 03110663-9693-43cc-96ee-63f409dae96b)

-- 1. 先将所有现有的 super_admin 降级为 admin（确保只有一个 super_admin）
UPDATE public.profiles
SET role = 'admin', updated_at = now()
WHERE role = 'super_admin'
  AND id != '03110663-9693-43cc-96ee-63f409dae96b';

-- 2. 将目标用户设为 super_admin
UPDATE public.profiles
SET role = 'super_admin', status = 'active', updated_at = now()
WHERE id = '03110663-9693-43cc-96ee-63f409dae96b';

-- 3. 如果目标用户不存在于 profiles 表，则插入（兜底）
INSERT INTO public.profiles (id, display_name, email, role, status, created_at, updated_at)
SELECT
  '03110663-9693-43cc-96ee-63f409dae96b',
  '366348802@qq.com',
  '366348802@qq.com',
  'super_admin',
  'active',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE id = '03110663-9693-43cc-96ee-63f409dae96b'
);
