-- Migration: 00024_fix_process_return_and_rls.sql
-- 1. 清理旧版 private.process_return (3参数)
-- 2. 清理旧版 public.process_return (7参数, 旧签名)
-- 3. 更新 process_return 照片为可选
-- 4. 修复 borrow_records DELETE RLS 策略增加 super_admin

-- 清理旧版 private.process_return
DROP FUNCTION IF EXISTS private.process_return(uuid, uuid, text);

-- 清理旧版 public.process_return (p_notes 在第3位)
DROP FUNCTION IF EXISTS public.process_return(uuid, text, text, timestamp with time zone, double precision, double precision, text);

-- 更新 process_return: 照片可选, p_notes 移到最后, 所有参数有默认值
CREATE OR REPLACE FUNCTION public.process_return(
  p_borrow_record_id UUID,
  p_photo_storage_path TEXT DEFAULT NULL,
  p_photo_captured_at TIMESTAMPTZ DEFAULT NULL,
  p_photo_latitude DOUBLE PRECISION DEFAULT NULL,
  p_photo_longitude DOUBLE PRECISION DEFAULT NULL,
  p_photo_address TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id UUID;
  v_borrower_id UUID;
  v_record_id UUID;
BEGIN
  SELECT id, item_id, borrower_id INTO v_record_id, v_item_id, v_borrower_id
  FROM public.borrow_records WHERE id = p_borrow_record_id;

  IF v_record_id IS NULL THEN
    SELECT id, item_id, borrower_id INTO v_record_id, v_item_id, v_borrower_id
    FROM public.borrow_records WHERE request_id = p_borrow_record_id;
  END IF;

  IF v_record_id IS NULL THEN
    RAISE EXCEPTION '借用记录不存在 (传入ID: %)', p_borrow_record_id;
  END IF;

  UPDATE public.borrow_records SET status = 'returned', return_date = CURRENT_DATE,
    notes = COALESCE(p_notes, notes), updated_at = now() WHERE id = v_record_id;

  -- 仅在提供了照片路径时才插入照片记录
  IF p_photo_storage_path IS NOT NULL THEN
    INSERT INTO public.return_photos (borrow_record_id, uploader_id, storage_path,
      captured_at, latitude, longitude, address)
    VALUES (v_record_id, v_borrower_id, p_photo_storage_path,
      COALESCE(p_photo_captured_at, now()), p_photo_latitude, p_photo_longitude, p_photo_address);
  END IF;

  UPDATE public.items SET status = 'in_stock', current_borrower_id = NULL,
    updated_at = now() WHERE id = v_item_id;

  INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
  VALUES (v_item_id, 'return_in', v_borrower_id, COALESCE(p_notes, '归还样机'));
END;
$$;

-- 修复 borrow_records DELETE RLS: 增加 super_admin
DROP POLICY IF EXISTS "管理员可删除借用记录" ON borrow_records;
CREATE POLICY "管理员可删除借用记录" ON borrow_records
  FOR DELETE USING (get_current_user_role() IN ('admin', 'super_admin'));
