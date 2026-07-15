-- 借用申请选择器需要展示样机的当前状态及对应日期。
-- 仅返回状态与日期，不暴露其他用户或申请单信息。
CREATE OR REPLACE FUNCTION public.get_borrowable_item_status_details()
RETURNS TABLE (
  item_id UUID,
  display_status TEXT,
  reserved_start_date DATE,
  reserved_end_date DATE,
  due_date DATE
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
    active_borrow.due_date
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
