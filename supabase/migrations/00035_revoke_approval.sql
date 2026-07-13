-- 超级管理员撤销已通过的审批
-- 1. 扩展 borrow_requests.status CHECK 增加 'revoked'
-- 2. 扩展 approval_records.action CHECK 增加 'revoked'
-- 3. 扩展 stock_movements.movement_type CHECK 增加 'revoke'
-- 4. 新建 revoke_approval(p_request_id, p_reason) RPC 函数 (SECURITY DEFINER)
-- 5. 扩展 trg_request_status_changed 触发器: revoked 状态也关闭未处理审批记录

-- =====================================================================
-- 1. 扩展 CHECK 约束
-- =====================================================================

-- borrow_requests.status: 增加 'revoked'
ALTER TABLE public.borrow_requests DROP CONSTRAINT IF EXISTS borrow_requests_status_check;
ALTER TABLE public.borrow_requests ADD CONSTRAINT borrow_requests_status_check
  CHECK (status IN ('pending', 'approved', 'partially_approved', 'rejected',
                    'cancelled', 'borrowed', 'returned', 'overdue',
                    'renewal_requested', 'revoked'));

-- approval_records.action: 增加 'revoked'
ALTER TABLE public.approval_records DROP CONSTRAINT IF EXISTS approval_records_action_check;
ALTER TABLE public.approval_records ADD CONSTRAINT approval_records_action_check
  CHECK (action IS NULL OR action IN ('approved', 'rejected', 'cancelled', 'revoked'));

-- stock_movements.movement_type: 增加 'revoke'
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN ('borrow_out', 'return_in', 'new_entry', 'maintenance', 'retire', 'revoke'));


-- =====================================================================
-- 2. revoke_approval 函数
--    仅超级管理员可调用; 撤销已通过(借用中/逾期/已归还)的审批
--    - borrowed/overdue: 回滚样机状态、删除借用记录、插入对冲库存变动
--    - returned: 样机已归还，保留借用记录与归还照片，仅标记审批撤销
-- =====================================================================
CREATE OR REPLACE FUNCTION public.revoke_approval(
  p_request_id UUID,
  p_reason TEXT
) RETURNS VOID AS $$
DECLARE
  v_request public.borrow_requests%ROWTYPE;
  v_borrow_record_id UUID;
  v_operator_id UUID;
  v_operator_role TEXT;
  v_requester_name TEXT;
  v_item_name TEXT;
  v_notif_message TEXT;
BEGIN
  -- 1. 验证身份：仅超级管理员
  v_operator_id := auth.uid();
  IF v_operator_id IS NULL THEN
    RAISE EXCEPTION '未登录，无法操作';
  END IF;

  SELECT role INTO v_operator_role FROM public.profiles WHERE id = v_operator_id;
  IF v_operator_role IS NULL OR v_operator_role != 'super_admin' THEN
    RAISE EXCEPTION '只有超级管理员可以撤销审批';
  END IF;

  -- 2. 加载申请
  SELECT * INTO v_request FROM public.borrow_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '申请不存在';
  END IF;

  -- 3. 验证状态：只允许撤销借用中/逾期/已归还的审批
  IF v_request.status NOT IN ('borrowed', 'overdue', 'returned') THEN
    RAISE EXCEPTION '只能撤销已通过且借出/逾期的审批，当前状态: %', v_request.status;
  END IF;

  -- 4. 回滚操作
  IF v_request.status IN ('borrowed', 'overdue') THEN
    -- 样机在借出中，需要完整回滚

    -- 4.1 获取对应的借用记录 ID（用于审计记录）
    SELECT id INTO v_borrow_record_id
    FROM public.borrow_records
    WHERE request_id = p_request_id
    ORDER BY created_at DESC LIMIT 1;

    -- 4.2 恢复样机状态为在库
    UPDATE public.items
    SET status = 'in_stock',
        current_borrower_id = NULL,
        updated_at = now()
    WHERE id = v_request.item_id;

    -- 4.3 删除借用记录（borrowed/overdue 状态无归还照片，可安全删除）
    DELETE FROM public.borrow_records
    WHERE request_id = p_request_id;

    -- 4.4 插入对冲库存变动记录（保留审计痕迹）
    INSERT INTO public.stock_movements (
      item_id, movement_type, borrow_record_id, operator_id, notes
    ) VALUES (
      v_request.item_id, 'revoke', v_borrow_record_id, v_operator_id,
      '撤销审批 - 申请编号: ' || v_request.request_number ||
      ' - 原因: ' || COALESCE(p_reason, '未填写')
    );
  END IF;
  -- returned 状态: 样机已归还(in_stock)，保留 borrow_records 和归还照片，仅标记审批撤销

  -- 5. 更新申请状态为已撤销，记录撤销原因
  UPDATE public.borrow_requests
  SET status = 'revoked',
      rejection_reason = '【审批撤销】' || COALESCE(p_reason, '超级管理员撤销'),
      updated_at = now()
  WHERE id = p_request_id;

  -- 6. 标记所有审批记录为已撤销
  UPDATE public.approval_records
  SET action = 'revoked',
      comment = COALESCE(p_reason, '超级管理员撤销审批'),
      acted_at = COALESCE(acted_at, now())
  WHERE request_id = p_request_id;

  -- 7. 给申请人发送站内通知
  SELECT display_name INTO v_requester_name
  FROM public.profiles WHERE id = v_request.requester_id;

  SELECT name INTO v_item_name
  FROM public.items WHERE id = v_request.item_id;

  v_notif_message := format(
    '您的借用申请 %s（样机：%s）已被超级管理员撤销：%s',
    v_request.request_number,
    COALESCE(v_item_name, '未知样机'),
    COALESCE(p_reason, '未填写原因')
  );

  INSERT INTO public.overdue_notifications (
    borrow_record_id, borrower_id, notification_type,
    notification_category, recipient_id, borrow_request_id,
    message, is_read
  ) VALUES (
    NULL, v_request.requester_id, 'push',
    'approval', v_request.requester_id, p_request_id,
    v_notif_message, false
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =====================================================================
-- 3. 扩展 trg_request_status_changed: revoked 状态也关闭未处理审批记录
--    （已通过的审批记录都已 acted，但保留兼容性）
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_request_status_changed()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
     OR (NEW.status = 'rejected' AND OLD.status != 'rejected')
     OR (NEW.status = 'revoked' AND OLD.status != 'revoked') THEN
    IF NEW.status = 'cancelled' THEN
      UPDATE public.approval_records
      SET acted_at = now(), action = 'cancelled', comment = '申请人已取消此申请'
      WHERE request_id = NEW.id AND acted_at IS NULL;
    ELSIF NEW.status = 'revoked' THEN
      UPDATE public.approval_records
      SET acted_at = now(), action = 'revoked', comment = '超级管理员撤销审批'
      WHERE request_id = NEW.id AND acted_at IS NULL;
    ELSE
      UPDATE public.approval_records
      SET acted_at = now(), action = 'rejected', comment = '前序步骤已拒绝，自动关闭'
      WHERE request_id = NEW.id AND acted_at IS NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 触发器已存在 (00033 创建)，此处仅替换函数体即可生效
