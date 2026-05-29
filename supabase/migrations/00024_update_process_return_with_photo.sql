-- 更新 process_return 函数，增加照片参数
-- 照片为必填项，函数内同时插入 return_photos 记录
-- 同时支持 borrow_record_id 和 request_id 传入

DROP FUNCTION IF EXISTS public.process_return(UUID, TEXT);
DROP FUNCTION IF EXISTS public.process_return(UUID, TEXT, TEXT, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION, TEXT);

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
  v_record_id UUID;
BEGIN
  -- 先按 borrow_record_id 查找
  SELECT id, item_id, borrower_id INTO v_record_id, v_item_id, v_borrower_id
  FROM public.borrow_records
  WHERE id = p_borrow_record_id;

  -- 如果没找到，尝试按 request_id 查找
  IF v_record_id IS NULL THEN
    SELECT id, item_id, borrower_id INTO v_record_id, v_item_id, v_borrower_id
    FROM public.borrow_records
    WHERE request_id = p_borrow_record_id;
  END IF;

  IF v_record_id IS NULL THEN
    RAISE EXCEPTION '借用记录不存在 (传入ID: %)', p_borrow_record_id;
  END IF;

  -- 验证必须提供照片
  IF p_photo_storage_path IS NULL THEN
    RAISE EXCEPTION '归还时必须提供照片';
  END IF;

  -- 更新借用记录状态
  UPDATE public.borrow_records
  SET status = 'returned',
      return_date = CURRENT_DATE,
      notes = COALESCE(p_notes, notes),
      updated_at = now()
  WHERE id = v_record_id;

  -- 插入照片记录
  INSERT INTO public.return_photos (
    borrow_record_id, uploader_id, storage_path,
    captured_at, latitude, longitude, address
  ) VALUES (
    v_record_id, v_borrower_id, p_photo_storage_path,
    COALESCE(p_photo_captured_at, now()),
    p_photo_latitude, p_photo_longitude, p_photo_address
  );

  -- 更新样机状态为在库
  UPDATE public.items
  SET status = 'in_stock',
      current_borrower_id = NULL,
      updated_at = now()
  WHERE id = v_item_id;

  -- 记录库存变动
  INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
  VALUES (v_item_id, 'return_in', v_borrower_id, COALESCE(p_notes, '归还样机'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
