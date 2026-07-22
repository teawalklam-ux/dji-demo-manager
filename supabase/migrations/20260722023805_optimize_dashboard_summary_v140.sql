-- Production migration history: 20260722023805_optimize_dashboard_summary_v140.
-- Collapse the dashboard's sequential count requests into one authenticated RPC.
-- SECURITY INVOKER preserves the caller's RLS visibility for items and requests.
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS TABLE (
  total BIGINT,
  in_stock BIGINT,
  reserved BIGINT,
  borrowed BIGINT,
  overdue BIGINT,
  monthly_requests BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH item_counts AS (
    SELECT
      COUNT(*)::BIGINT AS total_count,
      COUNT(*) FILTER (WHERE item.status = 'in_stock')::BIGINT AS physical_in_stock_count,
      COUNT(*) FILTER (WHERE item.status = 'borrowed')::BIGINT AS borrowed_count,
      COUNT(*) FILTER (WHERE item.status = 'overdue')::BIGINT AS overdue_count
    FROM public.items AS item
  ),
  reserved_counts AS (
    SELECT COUNT(*)::BIGINT AS reserved_count
    FROM public.get_reserved_item_ids()
  ),
  request_counts AS (
    SELECT COUNT(*)::BIGINT AS monthly_request_count
    FROM public.borrow_requests AS request
    WHERE request.created_at >= (
      date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai')
      AT TIME ZONE 'Asia/Shanghai'
    )
  )
  SELECT
    item_counts.total_count,
    GREATEST(item_counts.physical_in_stock_count - reserved_counts.reserved_count, 0::BIGINT),
    reserved_counts.reserved_count,
    item_counts.borrowed_count,
    item_counts.overdue_count,
    request_counts.monthly_request_count
  FROM item_counts
  CROSS JOIN reserved_counts
  CROSS JOIN request_counts;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated;

-- Return one lightweight, correctly counted page of items, including the derived
-- reservation status, so the browser no longer downloads and merges full tables.
CREATE OR REPLACE FUNCTION public.get_items_page(
  p_search TEXT DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  barcode TEXT,
  name TEXT,
  model TEXT,
  category_id UUID,
  status TEXT,
  display_status TEXT,
  location TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  category_name TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = '42501';
  END IF;

  IF p_offset < 0 OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION '分页参数无效' USING ERRCODE = '22023';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('in_stock', 'reserved', 'borrowed', 'overdue', 'maintenance', 'retired') THEN
    RAISE EXCEPTION '样机状态无效' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH reserved_ids AS (
    SELECT reserved_item.item_id
    FROM public.get_reserved_item_ids() AS reserved_item
  ),
  base_items AS (
    SELECT
      item.id,
      item.barcode,
      item.name,
      item.model,
      item.category_id,
      item.status AS item_status,
      CASE
        WHEN item.status = 'in_stock' AND reserved_item.item_id IS NOT NULL THEN 'reserved'
        ELSE item.status
      END AS item_display_status,
      item.location,
      item.created_at,
      item.updated_at,
      category.name AS item_category_name
    FROM public.items AS item
    LEFT JOIN reserved_ids AS reserved_item ON reserved_item.item_id = item.id
    LEFT JOIN public.categories AS category ON category.id = item.category_id
    WHERE (p_category_id IS NULL OR item.category_id = p_category_id)
      AND (
        NULLIF(BTRIM(p_search), '') IS NULL
        OR item.name ILIKE '%' || BTRIM(p_search) || '%'
        OR item.model ILIKE '%' || BTRIM(p_search) || '%'
        OR item.barcode ILIKE '%' || BTRIM(p_search) || '%'
        OR item.serial_number ILIKE '%' || BTRIM(p_search) || '%'
      )
  ),
  filtered_items AS (
    SELECT *
    FROM base_items
    WHERE p_status IS NULL OR item_display_status = p_status
  )
  SELECT
    filtered_item.id,
    filtered_item.barcode,
    filtered_item.name,
    filtered_item.model,
    filtered_item.category_id,
    filtered_item.item_status,
    filtered_item.item_display_status,
    filtered_item.location,
    filtered_item.created_at,
    filtered_item.updated_at,
    filtered_item.item_category_name,
    COUNT(*) OVER ()::BIGINT
  FROM filtered_items AS filtered_item
  ORDER BY filtered_item.created_at DESC, filtered_item.id DESC
  OFFSET p_offset
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_items_page(TEXT, UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_items_page(TEXT, UUID, TEXT, INTEGER, INTEGER) TO authenticated;
