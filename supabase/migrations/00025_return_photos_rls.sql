-- return_photos 表 RLS 策略 + Storage bucket 创建
-- 注意: 包含 super_admin 角色权限

-- ===== 1. 创建 Storage bucket =====
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'return-photos',
  'return-photos',
  false,  -- 私有 bucket
  5242880,  -- 5MB
  ARRAY['image/jpeg', 'image/png']
) ON CONFLICT (id) DO NOTHING;

-- ===== 2. return_photos 表 RLS =====
ALTER TABLE public.return_photos ENABLE ROW LEVEL SECURITY;

-- 归还人可查看自己的归还照片，管理员/超级管理员/审批人可查看所有
CREATE POLICY "归还人可查看自己的归还照片"
  ON public.return_photos FOR SELECT
  USING (
    uploader_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'super_admin', 'approver')
  );

-- 归还人可插入照片记录
CREATE POLICY "用户可创建归还照片记录"
  ON public.return_photos FOR INSERT
  WITH CHECK (uploader_id = (select auth.uid()));

-- 管理员/超级管理员可删除照片记录
CREATE POLICY "管理员可删除归还照片"
  ON public.return_photos FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- ===== 3. Storage RLS 策略 (return-photos bucket) =====
-- 用户可上传自己的归还照片（路径以 user_id 开头）
CREATE POLICY "用户可上传归还照片"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'return-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 用户可查看自己上传的照片，管理员/超级管理员/审批人可查看所有
CREATE POLICY "用户可查看归还照片"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'return-photos'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.get_current_user_role() IN ('admin', 'super_admin', 'approver')
    )
  );

-- 注意: Edge Function 使用 service_role_key，绕过 RLS，无需额外策略
