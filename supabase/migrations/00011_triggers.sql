-- ===== 触发器 =====

-- 1. 自动生成条码
CREATE SEQUENCE IF NOT EXISTS public.barcode_seq;

CREATE OR REPLACE FUNCTION public.generate_barcode()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.barcode IS NULL THEN
    NEW.barcode := 'DJI-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                   LPAD(nextval('public.barcode_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_barcode
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.generate_barcode();

-- 2. 自动生成申请编号
CREATE SEQUENCE IF NOT EXISTS public.request_seq;

CREATE OR REPLACE FUNCTION public.generate_request_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.request_number IS NULL THEN
    NEW.request_number := 'BR-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                          LPAD(nextval('public.request_seq')::TEXT, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_request_number
  BEFORE INSERT ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.generate_request_number();

-- 3. 审批通过后自动创建借用记录 + 更新样机状态
CREATE OR REPLACE FUNCTION public.on_request_approved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    -- 创建借用记录
    INSERT INTO public.borrow_records (
      request_id, item_id, borrower_id, borrow_type,
      borrow_date, due_date, status
    ) VALUES (
      NEW.id, NEW.item_id, NEW.requester_id, NEW.borrow_type,
      COALESCE(NEW.actual_borrow_date, CURRENT_DATE),
      NEW.expected_return_date,
      'active'
    );

    -- 更新样机状态为借用中
    UPDATE public.items
    SET status = 'borrowed',
        current_borrower_id = NEW.requester_id,
        updated_at = now()
    WHERE id = NEW.item_id;

    -- 记录库存变动
    INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
    VALUES (
      NEW.item_id, 'borrow_out', NEW.requester_id,
      '申请编号: ' || NEW.request_number
    );

    -- 更新申请的实际借用日期
    UPDATE public.borrow_requests
    SET actual_borrow_date = CURRENT_DATE, status = 'borrowed', updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_request_approved
  AFTER UPDATE ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.on_request_approved();

-- 4. 归还后自动更新样机状态
CREATE OR REPLACE FUNCTION public.on_borrow_returned()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'returned' AND (OLD.status IS NULL OR OLD.status != 'returned') THEN
    -- 更新样机状态为在库
    UPDATE public.items
    SET status = 'in_stock',
        current_borrower_id = NULL,
        updated_at = now()
    WHERE id = NEW.item_id;

    -- 记录库存变动
    INSERT INTO public.stock_movements (item_id, movement_type, operator_id, notes)
    VALUES (
      NEW.item_id, 'return_in', NEW.borrower_id,
      '归还, 借用记录ID: ' || NEW.id
    );

    -- 更新关联申请状态
    UPDATE public.borrow_requests
    SET status = 'returned',
        actual_return_date = CURRENT_DATE,
        updated_at = now()
    WHERE id = NEW.request_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_borrow_returned
  AFTER UPDATE ON public.borrow_records
  FOR EACH ROW EXECUTE FUNCTION public.on_borrow_returned();

-- 5. 逾期状态自动更新
CREATE OR REPLACE FUNCTION public.check_overdue_status()
RETURNS void AS $$
BEGIN
  UPDATE public.borrow_records
  SET status = 'overdue',
      overdue_days = CURRENT_DATE - due_date,
      updated_at = now()
  WHERE status = 'active' AND due_date < CURRENT_DATE;

  UPDATE public.items i
  SET status = 'overdue', updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.borrow_records br
    WHERE br.item_id = i.id AND br.status = 'overdue'
  );

  UPDATE public.borrow_requests br
  SET status = 'overdue', updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.borrow_records brec
    WHERE brec.request_id = br.id AND brec.status = 'overdue'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. updated_at 自动更新
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_items_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_borrow_requests_updated_at
  BEFORE UPDATE ON public.borrow_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_borrow_records_updated_at
  BEFORE UPDATE ON public.borrow_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_approval_chains_updated_at
  BEFORE UPDATE ON public.approval_chains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
