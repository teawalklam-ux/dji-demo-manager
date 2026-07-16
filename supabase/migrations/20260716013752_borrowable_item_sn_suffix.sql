-- 借用申请选择器仅需展示 SN 后四位，不向该查询返回完整序列号。
DROP FUNCTION IF EXISTS public.get_borrowable_item_status_details();

CREATE FUNCTION public.get_borrowable_item_status_details()
RETURNS TABLE (
  item_id UUID,
  display_status TEXT,
  reserved_start_date DATE,
  reserved_end_date DATE,
  due_date DATE,
  serial_number_last4 TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    item.id,
    CASE
      WHEN item.status IN ('borrowed', 'overdue') THEN 'borrowed'
      WHEN reservation.expected_borrow_date IS NOT NULL THEN 'reserved'
      ELSE 'in_stock'
    END,
    reservation.expected_borrow_date,
    reservation.expected_return_date,
    active_borrow.due_date,
    CASE
      WHEN NULLIF(BTRIM(item.serial_number), '') IS NULL THEN NULL
      ELSE RIGHT(BTRIM(item.serial_number), 4)
    END
  FROM public.items item
  LEFT JOIN LATERAL (
    SELECT request.expected_borrow_date, request.expected_return_date
    FROM public.borrow_request_items line
    JOIN public.borrow_requests request ON request.id = line.request_id
    WHERE line.item_id = item.id
      AND line.status = 'reserved'
      AND request.status = 'approved'
      AND request.expected_borrow_date > (now() AT TIME ZONE 'Asia/Shanghai')::DATE
    ORDER BY request.expected_borrow_date
    LIMIT 1
  ) reservation ON true
  LEFT JOIN LATERAL (
    SELECT record.due_date
    FROM public.borrow_records record
    WHERE record.item_id = item.id
      AND record.status IN ('active', 'overdue')
    ORDER BY record.due_date
    LIMIT 1
  ) active_borrow ON true
  WHERE item.status IN ('in_stock', 'borrowed', 'overdue')
  ORDER BY item.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_borrowable_item_status_details() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_borrowable_item_status_details() TO authenticated;
