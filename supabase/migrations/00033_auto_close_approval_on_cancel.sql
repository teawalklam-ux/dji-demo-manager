-- 修复：取消/拒绝申请后，审批记录未自动关闭，导致已取消的申请仍留在审批队列
-- 问题1: 用户取消申请时只更新 borrow_requests.status='cancelled', 没有更新 approval_records
-- 问题2: 审批拒绝时 process_approval 只关闭当前步骤记录, 后续步骤记录仍 acted_at IS NULL
-- 方案: 创建触发器, 当 borrow_requests.status 变为 cancelled/rejected 时自动关闭未处理审批记录

-- 1. 放宽 approval_records.action CHECK 约束, 增加 'cancelled'
ALTER TABLE public.approval_records DROP CONSTRAINT IF EXISTS approval_records_action_check;
ALTER TABLE public.approval_records ADD CONSTRAINT approval_records_action_check
  CHECK (action IS NULL OR action IN ('approved', 'rejected', 'cancelled'));

-- 2. 触发器函数: 根据申请状态变更自动关闭未处理审批记录
CREATE OR REPLACE FUNCTION public.handle_request_status_changed()
RETURNS TRIGGER AS $$
BEGIN
  -- 仅当 status 从其他状态变为 cancelled 或 rejected 时触发
  IF (NEW.status = 'cancelled' AND OLD.status != 'cancelled')
     OR (NEW.status = 'rejected' AND OLD.status != 'rejected') THEN

    IF NEW.status = 'cancelled' THEN
      UPDATE public.approval_records
      SET acted_at = now(), action = 'cancelled', comment = '申请人已取消此申请'
      WHERE request_id = NEW.id AND acted_at IS NULL;
    ELSE
      -- rejected: 关闭后续未处理步骤（当前步骤已由 process_approval 处理）
      UPDATE public.approval_records
      SET acted_at = now(), action = 'rejected', comment = '前序步骤已拒绝，自动关闭'
      WHERE request_id = NEW.id AND acted_at IS NULL;
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 创建触发器
DROP TRIGGER IF EXISTS trg_request_status_changed ON public.borrow_requests;
CREATE TRIGGER trg_request_status_changed
  AFTER UPDATE OF status ON public.borrow_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_request_status_changed();
