-- 样机列表的“预定”派生状态。
-- 预定不是库存物理状态：只有仍在库、存在未来已审批预约的样机才显示为预定。
CREATE OR REPLACE FUNCTION public.get_reserved_item_ids()
RETURNS TABLE (item_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT line.item_id
  FROM public.borrow_request_items line
  JOIN public.borrow_requests request ON request.id = line.request_id
  JOIN public.items item ON item.id = line.item_id
  WHERE line.status = 'reserved'
    AND request.status = 'approved'
    AND request.expected_borrow_date > (now() AT TIME ZONE 'Asia/Shanghai')::DATE
    AND item.status = 'in_stock';
END;
$$;

REVOKE ALL ON FUNCTION public.get_reserved_item_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reserved_item_ids() TO authenticated;
