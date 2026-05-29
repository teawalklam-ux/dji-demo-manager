-- ==========================================
-- 归还拍照功能 - 合并 SQL 脚本
-- 包含: 00023 + 00024 + 00025（含 super_admin 修复）+ Storage bucket 创建
-- 在 Supabase Dashboard → SQL Editor 中执行
-- ==========================================

-- ===== 1. 创建 return_photos 表 =====
CREATE TABLE IF NOT EXISTS public.return_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_record_id UUID NOT NULL REFERENCES public.borrow_records(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES public.profiles(id),
  storage_path TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  address TEXT,
  photo_deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_return_photos_borrow_record ON public.return_photos(borrow_record_id);
CREATE INDEX IF NOT EXISTS idx_return_photos_created_at ON public.return_photos(created_at);
CREATE INDEX IF NOT EXISTS idx_return_photos_photo_deleted_at ON public.return_photos(photo_deleted_at)
  WHERE photo_deleted_at IS NULL;

COMMENT ON TABLE public.return_photos IS '归还照片记录，照片30天自动删除，元数据保留1年';
COMMENT ON COLUMN public.return_photos.photo_deleted_at IS 'NULL表示照片仍在Storage中，非NULL表示已从Storage删除';

-- ===== 2. 更新 process_return 函数（增加照片参数） =====
-- 先删除旧版本，避免参数歧义
DROP FUNCTION IF EXISTS public.process_return(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.process_return(
  p_borrow_record_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_photo_storage_path TEXT DEFAULT NULL,
  p_photo_captured_at TIMESTAMPTZ DEFAULT NULL,
  p_photo_latitude DOUBLE PRECISION DEFAULT NULL,
  p_photo_longitude DOUBLE PRECISION DEFAULT NULL,
  p_photo_address TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_item_id UUID;
  v_borrower_id UUID;
BEGIN
  SELECT item_id, borrower_id INTO v_item_id, v_borrower_id
  FROM public.borrow_records
  WHERE id = p_borrow_record_id;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION '借用记录不存在';
  END IF;

  IF p_photo_storage_path IS NULL THEN
    RAISE EXCEPTION '归还时必须提供照片';
  END IF;

  UPDATE public.borrow_records
  SET status = 'returned',
      return_date = CURRENT_DATE,
      notes = COALESCE(p_notes, notes),
      updated_at = now()
  WHERE id = p_borrow_record_id;

  INSERT INTO public.return_photos (
    borrow_record_id, uploader_id, storage_path,
    captured_at, latitude, longitude, address
  ) VALUES (
    p_borrow_record_id, v_borrower_id, p_photo_storage_path,
    COALESCE(p_photo_captured_at, now()),
    p_photo_latitude, p_photo_longitude, p_photo_address
  );

  UPDATE public.items
  SET status = 'in_stock',
      current_borrower_id = NULL,
      updated_at = now()
  WHERE id = v_item_id;

  INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
  VALUES (v_item_id, 'return_in', v_borrower_id, COALESCE(p_notes, '归还样机'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===== 3. 创建 Storage bucket =====
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'return-photos',
  'return-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png']
) ON CONFLICT (id) DO NOTHING;

-- ===== 4. return_photos 表 RLS 策略 =====
ALTER TABLE public.return_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "归还人可查看自己的归还照片" ON public.return_photos;
CREATE POLICY "归还人可查看自己的归还照片"
  ON public.return_photos FOR SELECT
  USING (
    uploader_id = (select auth.uid())
    OR public.get_current_user_role() IN ('admin', 'super_admin', 'approver')
  );

DROP POLICY IF EXISTS "用户可创建归还照片记录" ON public.return_photos;
CREATE POLICY "用户可创建归还照片记录"
  ON public.return_photos FOR INSERT
  WITH CHECK (uploader_id = (select auth.uid()));

DROP POLICY IF EXISTS "管理员可删除归还照片" ON public.return_photos;
CREATE POLICY "管理员可删除归还照片"
  ON public.return_photos FOR DELETE
  USING (public.get_current_user_role() IN ('admin', 'super_admin'));

-- ===== 5. Storage RLS 策略 =====
DROP POLICY IF EXISTS "用户可上传归还照片" ON storage.objects;
CREATE POLICY "用户可上传归还照片"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'return-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "用户可查看归还照片" ON storage.objects;
CREATE POLICY "用户可查看归还照片"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'return-photos'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.get_current_user_role() IN ('admin', 'super_admin', 'approver')
    )
  );

-- ===== 完成 =====
SELECT '归还拍照功能 SQL 全部执行完成！' AS result;
