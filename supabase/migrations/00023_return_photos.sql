-- 归还照片表
-- 照片文件保留30天自动删除，元数据保留1年
CREATE TABLE public.return_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_record_id UUID NOT NULL REFERENCES public.borrow_records(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES public.profiles(id),
  storage_path TEXT NOT NULL,           -- Supabase Storage 中的文件路径
  captured_at TIMESTAMPTZ NOT NULL,     -- 拍照时的时间戳（系统读取，非用户输入）
  latitude DOUBLE PRECISION,            -- GPS 纬度
  longitude DOUBLE PRECISION,           -- GPS 经度
  address TEXT,                         -- 逆地理编码后的地址文本（可选）
  photo_deleted_at TIMESTAMPTZ,         -- 照片被清理的时间（软标记，NULL表示照片仍在Storage中）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_return_photos_borrow_record ON public.return_photos(borrow_record_id);
CREATE INDEX idx_return_photos_created_at ON public.return_photos(created_at);
CREATE INDEX idx_return_photos_photo_deleted_at ON public.return_photos(photo_deleted_at)
  WHERE photo_deleted_at IS NULL;

COMMENT ON TABLE public.return_photos IS '归还照片记录，照片30天自动删除，元数据保留1年';
COMMENT ON COLUMN public.return_photos.photo_deleted_at IS 'NULL表示照片仍在Storage中，非NULL表示已从Storage删除';
