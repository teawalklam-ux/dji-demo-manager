-- 多样机预约：申请单头 + 样机明细，审批通过仅预约，到借用日自动出借。
-- 此迁移可安全作用于已有单样机历史数据。

ALTER TABLE public.borrow_requests
  DROP CONSTRAINT IF EXISTS borrow_requests_status_check;
ALTER TABLE public.borrow_requests
  ADD CONSTRAINT borrow_requests_status_check CHECK (status IN (
    'pending', 'approved', 'partially_approved', 'rejected', 'cancelled',
    'borrowed', 'partially_returned', 'returned', 'overdue',
    'renewal_requested', 'revoked'
  ));

CREATE TABLE IF NOT EXISTS public.borrow_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.borrow_requests(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reserved', 'borrowed', 'returned', 'cancelled')),
  actual_borrow_date DATE,
  actual_return_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_borrow_request_items_item_status
  ON public.borrow_request_items (item_id, status);
CREATE INDEX IF NOT EXISTS idx_borrow_request_items_request
  ON public.borrow_request_items (request_id);

ALTER TABLE public.borrow_records
  ADD COLUMN IF NOT EXISTS request_item_id UUID REFERENCES public.borrow_request_items(id);

-- 回填历史单据：每个旧申请单生成一条样机明细，并关联已有借用记录。
INSERT INTO public.borrow_request_items (request_id, item_id, status, actual_borrow_date, actual_return_date)
SELECT
  br.id,
  br.item_id,
  CASE
    WHEN br.status = 'returned' THEN 'returned'
    WHEN br.status IN ('borrowed', 'overdue') THEN 'borrowed'
    WHEN br.status IN ('approved', 'partially_approved') THEN 'reserved'
    WHEN br.status IN ('cancelled', 'rejected', 'revoked') THEN 'cancelled'
    ELSE 'pending'
  END,
  br.actual_borrow_date,
  br.actual_return_date
FROM public.borrow_requests br
WHERE NOT EXISTS (
  SELECT 1 FROM public.borrow_request_items existing
  WHERE existing.request_id = br.id AND existing.item_id = br.item_id
);

UPDATE public.borrow_records rec
SET request_item_id = line.id
FROM public.borrow_request_items line
WHERE rec.request_item_id IS NULL
  AND line.request_id = rec.request_id
  AND line.item_id = rec.item_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_borrow_records_request_item
  ON public.borrow_records (request_item_id)
  WHERE request_item_id IS NOT NULL;

ALTER TABLE public.borrow_request_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "申请相关人员可查看申请样机明细" ON public.borrow_request_items;
CREATE POLICY "申请相关人员可查看申请样机明细"
  ON public.borrow_request_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.borrow_requests request
      WHERE request.id = request_id
        AND (
          request.requester_id = (select auth.uid())
          OR public.get_current_user_role() IN ('super_admin', 'admin', 'approver')
        )
    )
  );
REVOKE ALL ON TABLE public.borrow_request_items FROM anon, authenticated;
GRANT SELECT ON TABLE public.borrow_request_items TO authenticated;

-- 由触发器维护明细更新时间；业务写入只允许受控函数完成。
DROP TRIGGER IF EXISTS trg_borrow_request_items_updated_at ON public.borrow_request_items;
CREATE TRIGGER trg_borrow_request_items_updated_at
  BEFORE UPDATE ON public.borrow_request_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 旧触发器会在审批后立即借出，现改为空操作；实际出借由 activate_due_borrow_requests 完成。
CREATE OR REPLACE FUNCTION public.on_request_approved()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- 避免旧的单记录归还触发器把包含多台样机的申请直接结单。
CREATE OR REPLACE FUNCTION public.on_borrow_returned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- 返回已确认预约或实际借用占用的日期；待审批申请不占用。
CREATE OR REPLACE FUNCTION public.check_borrow_availability(
  p_item_ids UUID[],
  p_expected_borrow_date DATE,
  p_expected_return_date DATE,
  p_exclude_request_id UUID DEFAULT NULL
)
RETURNS TABLE (
  item_id UUID,
  item_name TEXT,
  occupied_start_date DATE,
  occupied_end_date DATE,
  occupied_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Shanghai')::DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = '42501';
  END IF;
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RAISE EXCEPTION '请至少选择一台样机';
  END IF;
  IF p_expected_borrow_date IS NULL
     OR p_expected_return_date IS NULL
     OR p_expected_return_date < p_expected_borrow_date THEN
    RAISE EXCEPTION '借用日期无效';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (line.item_id)
    line.item_id,
    item.name,
    request.expected_borrow_date,
    request.expected_return_date,
    request.status
  FROM public.borrow_request_items line
  JOIN public.borrow_requests request ON request.id = line.request_id
  JOIN public.items item ON item.id = line.item_id
  WHERE line.item_id = ANY(p_item_ids)
    AND line.status IN ('reserved', 'borrowed')
    AND request.status IN ('approved', 'borrowed', 'partially_returned', 'overdue')
    AND (p_exclude_request_id IS NULL OR request.id <> p_exclude_request_id)
    AND (
      (request.status = 'overdue' AND p_expected_return_date >= v_today)
      OR (
        request.expected_borrow_date <= p_expected_return_date
        AND request.expected_return_date >= p_expected_borrow_date
      )
    )
  ORDER BY line.item_id, request.expected_borrow_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_borrow_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.borrow_requests%ROWTYPE;
  v_conflicts TEXT;
BEGIN
  SELECT * INTO v_request FROM public.borrow_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '申请不存在';
  END IF;

  -- 以样机行锁串行化最终审批，避免两个审批事务同时通过同一日期。
  PERFORM 1
  FROM public.items item
  WHERE item.id IN (
    SELECT line.item_id FROM public.borrow_request_items line WHERE line.request_id = p_request_id
  )
  ORDER BY item.id
  FOR UPDATE;

  SELECT string_agg(format('%s（%s 至 %s）', item_name, occupied_start_date, occupied_end_date), '、')
  INTO v_conflicts
  FROM public.check_borrow_availability(
    ARRAY(SELECT item_id FROM public.borrow_request_items WHERE request_id = p_request_id),
    v_request.expected_borrow_date,
    v_request.expected_return_date,
    p_request_id
  );

  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION '以下样机的日期已审批通过，无法申请：%', v_conflicts
      USING ERRCODE = '23P01';
  END IF;

  UPDATE public.borrow_request_items
  SET status = 'reserved'
  WHERE request_id = p_request_id AND status = 'pending';

  UPDATE public.borrow_requests
  SET status = 'approved', updated_at = now()
  WHERE id = p_request_id;
END;
$$;

DROP FUNCTION IF EXISTS public.create_borrow_request(UUID, UUID, TEXT, TEXT, DATE, DATE, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.create_borrow_request(
  p_requester_id UUID,
  p_item_ids UUID[],
  p_borrow_type TEXT,
  p_purpose TEXT,
  p_expected_borrow_date DATE,
  p_expected_return_date DATE,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_contact TEXT DEFAULT NULL,
  p_parent_request_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_chain_id UUID;
  v_chain_steps JSONB;
  v_step JSONB;
  v_approver_id UUID;
  v_first_approver_id UUID;
  v_first_step_level INT := 2147483647;
BEGIN
  IF auth.uid() IS NULL OR p_requester_id <> auth.uid() THEN
    RAISE EXCEPTION '无权创建该申请' USING ERRCODE = '42501';
  END IF;
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0
     OR cardinality(p_item_ids) <> cardinality(ARRAY(SELECT DISTINCT id FROM unnest(p_item_ids) AS id)) THEN
    RAISE EXCEPTION '请至少选择一台不同的样机';
  END IF;
  IF p_expected_borrow_date < (now() AT TIME ZONE 'Asia/Shanghai')::DATE
     OR p_expected_return_date < p_expected_borrow_date THEN
    RAISE EXCEPTION '借用日期无效';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.items
    WHERE id = ANY(p_item_ids) AND status IN ('maintenance', 'retired')
  ) OR (SELECT count(*) FROM public.items WHERE id = ANY(p_item_ids)) <> cardinality(p_item_ids) THEN
    RAISE EXCEPTION '所选样机不存在、维修中或已退役';
  END IF;

  INSERT INTO public.borrow_requests (
    requester_id, item_id, borrow_type, purpose, customer_name, customer_contact,
    expected_borrow_date, expected_return_date, parent_request_id, status
  ) VALUES (
    p_requester_id, p_item_ids[1], p_borrow_type, p_purpose, p_customer_name, p_customer_contact,
    p_expected_borrow_date, p_expected_return_date, p_parent_request_id,
    CASE WHEN p_parent_request_id IS NULL THEN 'pending' ELSE 'renewal_requested' END
  ) RETURNING id INTO v_request_id;

  INSERT INTO public.borrow_request_items (request_id, item_id)
  SELECT v_request_id, id FROM unnest(p_item_ids) AS id;

  SELECT id, steps INTO v_chain_id, v_chain_steps
  FROM public.approval_chains
  WHERE borrow_type IN (p_borrow_type, 'all') AND is_active = true
  ORDER BY borrow_type DESC
  LIMIT 1;

  IF v_chain_id IS NULL THEN
    PERFORM public.reserve_borrow_request(v_request_id);
    RETURN v_request_id;
  END IF;

  FOR i IN 0..jsonb_array_length(v_chain_steps) - 1 LOOP
    v_step := v_chain_steps -> i;
    v_approver_id := NULL;
    IF v_step ->> 'type' = 'person' THEN
      v_approver_id := (v_step ->> 'user_id')::UUID;
    ELSE
      SELECT id INTO v_approver_id FROM public.profiles
      WHERE role = v_step ->> 'role' AND is_active = true
      ORDER BY created_at LIMIT 1;
      IF v_approver_id IS NULL THEN
        SELECT id INTO v_approver_id FROM public.profiles
        WHERE role IN ('super_admin', 'admin') AND is_active = true
        ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END, created_at LIMIT 1;
      END IF;
    END IF;
    INSERT INTO public.approval_records (request_id, chain_id, approver_id, step_level)
    VALUES (v_request_id, v_chain_id, v_approver_id, (v_step ->> 'level')::INT);
    IF v_approver_id IS NOT NULL AND (v_step ->> 'level')::INT < v_first_step_level THEN
      v_first_approver_id := v_approver_id;
      v_first_step_level := (v_step ->> 'level')::INT;
    END IF;
  END LOOP;

  IF v_first_approver_id IS NOT NULL THEN
    INSERT INTO public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type, notification_category,
      recipient_id, borrow_request_id, message, is_read
    ) VALUES (
      NULL, p_requester_id, 'push', 'approval', v_first_approver_id, v_request_id,
      format('新审批申请：%s 台样机，借用日期：%s 至 %s', cardinality(p_item_ids), p_expected_borrow_date, p_expected_return_date), false
    );
  END IF;
  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_approval(
  p_request_id UUID,
  p_action TEXT,
  p_comment TEXT DEFAULT NULL,
  p_approver_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record public.approval_records%ROWTYPE;
  v_approver_id UUID := COALESCE(p_approver_id, auth.uid());
  v_role TEXT;
  v_is_final BOOLEAN;
  v_requester_id UUID;
  v_request_number TEXT;
  v_next_approver_id UUID;
BEGIN
  IF v_approver_id IS NULL OR p_action NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION '审批参数无效';
  END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_approver_id;
  IF v_role IN ('super_admin', 'admin') THEN
    SELECT * INTO v_record FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NULL
    ORDER BY step_level LIMIT 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_record FROM public.approval_records
    WHERE request_id = p_request_id AND approver_id = v_approver_id AND acted_at IS NULL
    ORDER BY step_level LIMIT 1 FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION '没有找到待您审批的记录';
  END IF;
  SELECT requester_id, request_number INTO v_requester_id, v_request_number
  FROM public.borrow_requests WHERE id = p_request_id;

  IF p_action = 'rejected' THEN
    UPDATE public.approval_records SET action = 'rejected', comment = p_comment, acted_at = now(), approver_id = v_approver_id WHERE id = v_record.id;
    UPDATE public.borrow_request_items SET status = 'cancelled' WHERE request_id = p_request_id AND status = 'pending';
    UPDATE public.borrow_requests SET status = 'rejected', rejection_reason = p_comment, updated_at = now() WHERE id = p_request_id;
    INSERT INTO public.overdue_notifications (borrow_record_id, borrower_id, notification_type, notification_category, recipient_id, borrow_request_id, message, is_read)
    VALUES (NULL, v_requester_id, 'push', 'approval', v_requester_id, p_request_id, '审批被拒绝：' || v_request_number, false);
    RETURN v_record.id;
  END IF;

  v_is_final := v_role IN ('super_admin', 'admin') OR NOT EXISTS (
    SELECT 1 FROM public.approval_records WHERE request_id = p_request_id AND acted_at IS NULL AND id <> v_record.id
  );
  IF v_is_final THEN
    -- 先校验并锁定预约，再写最终审批动作；冲突时审批记录保持未处理。
    PERFORM public.reserve_borrow_request(p_request_id);
    UPDATE public.approval_records
    SET action = 'approved', comment = p_comment, acted_at = now(), approver_id = v_approver_id
    WHERE request_id = p_request_id AND acted_at IS NULL;
    INSERT INTO public.overdue_notifications (borrow_record_id, borrower_id, notification_type, notification_category, recipient_id, borrow_request_id, message, is_read)
    VALUES (NULL, v_requester_id, 'push', 'approval', v_requester_id, p_request_id, '审批通过，样机已预约：' || v_request_number, false);
  ELSE
    UPDATE public.approval_records SET action = 'approved', comment = p_comment, acted_at = now(), approver_id = v_approver_id WHERE id = v_record.id;
    UPDATE public.borrow_requests SET status = 'partially_approved', updated_at = now() WHERE id = p_request_id;
    SELECT approver_id INTO v_next_approver_id FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NULL ORDER BY step_level LIMIT 1;
    IF v_next_approver_id IS NOT NULL THEN
      INSERT INTO public.overdue_notifications (borrow_record_id, borrower_id, notification_type, notification_category, recipient_id, borrow_request_id, message, is_read)
      VALUES (NULL, v_requester_id, 'push', 'approval', v_next_approver_id, p_request_id, '新的待审批申请：' || v_request_number, false);
    END IF;
  END IF;
  RETURN v_record.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_due_borrow_requests(
  p_on_date DATE DEFAULT (now() AT TIME ZONE 'Asia/Shanghai')::DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_activated_count INTEGER := 0;
  v_unavailable TEXT;
BEGIN
  FOR v_request IN
    SELECT id, requester_id, borrow_type, expected_return_date, request_number
    FROM public.borrow_requests
    WHERE status = 'approved' AND expected_borrow_date <= p_on_date
    ORDER BY expected_borrow_date, created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM 1 FROM public.items item
    JOIN public.borrow_request_items line ON line.item_id = item.id
    WHERE line.request_id = v_request.id
    ORDER BY item.id FOR UPDATE;

    SELECT string_agg(item.name, '、') INTO v_unavailable
    FROM public.items item
    JOIN public.borrow_request_items line ON line.item_id = item.id
    WHERE line.request_id = v_request.id AND item.status <> 'in_stock';
    IF v_unavailable IS NOT NULL THEN
      INSERT INTO public.overdue_notifications (
        borrow_record_id, borrower_id, notification_type, notification_category,
        recipient_id, borrow_request_id, message, is_read
      ) VALUES (
        NULL, v_request.requester_id, 'push', 'approval', v_request.requester_id, v_request.id,
        format('预约单 %s 到期未自动出借：%s 当前不可用，请联系管理员处理。', v_request.request_number, v_unavailable), false
      );
      CONTINUE;
    END IF;

    INSERT INTO public.borrow_records (
      request_id, request_item_id, item_id, borrower_id, borrow_type, borrow_date, due_date, status
    )
    SELECT v_request.id, line.id, line.item_id, v_request.requester_id, v_request.borrow_type,
      p_on_date, v_request.expected_return_date, 'active'
    FROM public.borrow_request_items line
    WHERE line.request_id = v_request.id AND line.status = 'reserved';

    UPDATE public.borrow_request_items
    SET status = 'borrowed', actual_borrow_date = p_on_date
    WHERE request_id = v_request.id AND status = 'reserved';
    UPDATE public.items item
    SET status = 'borrowed', current_borrower_id = v_request.requester_id, updated_at = now()
    FROM public.borrow_request_items line
    WHERE line.request_id = v_request.id AND line.item_id = item.id;
    INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
    SELECT line.item_id, 'borrow_out', v_request.requester_id, '自动出借，申请编号: ' || v_request.request_number
    FROM public.borrow_request_items line WHERE line.request_id = v_request.id;
    UPDATE public.borrow_requests
    SET status = 'borrowed', actual_borrow_date = p_on_date, updated_at = now()
    WHERE id = v_request.id;
    v_activated_count := v_activated_count + 1;
  END LOOP;
  RETURN v_activated_count;
END;
$$;

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
  v_record public.borrow_records%ROWTYPE;
  v_role TEXT;
  v_all_returned BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '未登录' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_record FROM public.borrow_records WHERE id = p_borrow_record_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '借用记录不存在'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_record.borrower_id <> auth.uid() AND v_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION '无权归还该样机' USING ERRCODE = '42501';
  END IF;
  IF v_record.status = 'returned' THEN RAISE EXCEPTION '该样机已归还'; END IF;

  UPDATE public.borrow_records SET status = 'returned', return_date = CURRENT_DATE, notes = COALESCE(p_notes, notes), updated_at = now() WHERE id = v_record.id;
  UPDATE public.borrow_request_items
  SET status = 'returned', actual_return_date = CURRENT_DATE, updated_at = now()
  WHERE id = v_record.request_item_id;
  IF p_photo_storage_path IS NOT NULL THEN
    INSERT INTO public.return_photos (borrow_record_id, uploader_id, storage_path, captured_at, latitude, longitude, address)
    VALUES (v_record.id, auth.uid(), p_photo_storage_path, COALESCE(p_photo_captured_at, now()), p_photo_latitude, p_photo_longitude, p_photo_address);
  END IF;
  UPDATE public.items SET status = 'in_stock', current_borrower_id = NULL, updated_at = now() WHERE id = v_record.item_id;
  INSERT INTO public.stock_movements (item_id, movement_type, borrow_record_id, operator_id, notes)
  VALUES (v_record.item_id, 'return_in', v_record.id, auth.uid(), COALESCE(p_notes, '归还样机'));
  SELECT NOT EXISTS (
    SELECT 1 FROM public.borrow_request_items WHERE request_id = v_record.request_id AND status <> 'returned'
  ) INTO v_all_returned;
  UPDATE public.borrow_requests
  SET status = CASE WHEN v_all_returned THEN 'returned' ELSE 'partially_returned' END,
      actual_return_date = CASE WHEN v_all_returned THEN CURRENT_DATE ELSE actual_return_date END,
      updated_at = now()
  WHERE id = v_record.request_id;
END;
$$;

-- 已审批但尚未出借的预约也允许超级管理员撤销，以释放未来日期。
CREATE OR REPLACE FUNCTION public.revoke_approval(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.borrow_requests%ROWTYPE;
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '未登录' USING ERRCODE = '42501'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role <> 'super_admin' THEN RAISE EXCEPTION '只有超级管理员可以撤销审批' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_request FROM public.borrow_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('approved', 'borrowed', 'overdue', 'partially_returned', 'returned') THEN
    RAISE EXCEPTION '当前申请不能撤销';
  END IF;

  IF v_request.status = 'approved' THEN
    UPDATE public.borrow_request_items SET status = 'cancelled' WHERE request_id = p_request_id AND status IN ('pending', 'reserved');
  ELSIF v_request.status IN ('borrowed', 'overdue', 'partially_returned') THEN
    UPDATE public.items item SET status = 'in_stock', current_borrower_id = NULL, updated_at = now()
    FROM public.borrow_records record
    WHERE record.request_id = p_request_id AND record.status IN ('active', 'overdue') AND record.item_id = item.id;
    DELETE FROM public.borrow_records WHERE request_id = p_request_id AND status IN ('active', 'overdue');
    UPDATE public.borrow_request_items SET status = 'cancelled' WHERE request_id = p_request_id AND status <> 'returned';
  END IF;

  UPDATE public.borrow_requests
  SET status = 'revoked', rejection_reason = '【审批撤销】' || COALESCE(p_reason, '超级管理员撤销'), updated_at = now()
  WHERE id = p_request_id;
  UPDATE public.approval_records
  SET action = 'revoked', comment = COALESCE(p_reason, '超级管理员撤销审批'), acted_at = COALESCE(acted_at, now())
  WHERE request_id = p_request_id;
  INSERT INTO public.overdue_notifications (borrow_record_id, borrower_id, notification_type, notification_category, recipient_id, borrow_request_id, message, is_read)
  VALUES (NULL, v_request.requester_id, 'push', 'approval', v_request.requester_id, p_request_id, '审批已撤销：' || v_request.request_number, false);
END;
$$;

REVOKE ALL ON FUNCTION public.check_borrow_availability(UUID[], DATE, DATE, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_borrow_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_due_borrow_requests(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_borrow_request(UUID, UUID[], TEXT, TEXT, DATE, DATE, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_approval(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_return(UUID, TEXT, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_approval(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_borrow_availability(UUID[], DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_borrow_request(UUID, UUID[], TEXT, TEXT, DATE, DATE, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_approval(UUID, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_return(UUID, TEXT, TIMESTAMPTZ, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_approval(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_due_borrow_requests(DATE) TO service_role;
