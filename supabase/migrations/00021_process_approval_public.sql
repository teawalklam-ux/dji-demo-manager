-- ===== 修复：super_admin/admin 可审批所有流程 + 逾期提醒优化 =====

-- 1. 将 process_approval 移到 public schema，并允许 super_admin/admin 审批所有记录
CREATE OR REPLACE FUNCTION public.process_approval(
  p_request_id UUID,
  p_action TEXT,
  p_comment TEXT DEFAULT NULL,
  p_approver_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_chain_id UUID;
  v_step_level INT;
  v_record_id UUID;
  v_acted_count INT;
  v_total_steps INT;
  v_approver_id UUID;
  v_approver_role TEXT;
BEGIN
  -- 确定审批人ID
  v_approver_id := COALESCE(p_approver_id, auth.uid());

  -- 获取审批人角色
  SELECT role INTO v_approver_role FROM public.profiles WHERE id = v_approver_id;

  -- 查找该请求对应的待审批记录
  IF v_approver_role IN ('super_admin', 'admin') THEN
    -- super_admin/admin 可以审批任何未审批的记录
    SELECT id, chain_id, step_level INTO v_record_id, v_chain_id, v_step_level
    FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NULL
    ORDER BY step_level ASC
    LIMIT 1;
  ELSE
    -- 其他角色只能审批自己负责的记录
    SELECT id, chain_id, step_level INTO v_record_id, v_chain_id, v_step_level
    FROM public.approval_records
    WHERE request_id = p_request_id AND approver_id = v_approver_id AND acted_at IS NULL
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '没有找到待您审批的记录';
  END IF;

  -- 记录审批动作（如果是 admin/super_admin 代理审批，设置 approver_id 为实际审批人）
  UPDATE public.approval_records
  SET action = p_action,
      comment = p_comment,
      acted_at = now(),
      approver_id = v_approver_id
  WHERE id = v_record_id;

  IF p_action = 'rejected' THEN
    UPDATE public.borrow_requests SET status = 'rejected', rejection_reason = p_comment, updated_at = now()
    WHERE id = p_request_id;
  ELSE
    -- super_admin/admin 代理审批时，一次性通过所有剩余步骤
    IF v_approver_role IN ('super_admin', 'admin') THEN
      UPDATE public.approval_records
      SET action = 'approved', acted_at = now(), approver_id = v_approver_id
      WHERE request_id = p_request_id AND acted_at IS NULL;
    END IF;

    -- 检查是否还有未审批的步骤
    SELECT COUNT(*) INTO v_acted_count
    FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NOT NULL;

    SELECT jsonb_array_length(steps) INTO v_total_steps
    FROM public.approval_chains WHERE id = v_chain_id;

    IF v_acted_count >= v_total_steps THEN
      -- 所有步骤已审批通过
      UPDATE public.borrow_requests SET status = 'approved', updated_at = now()
      WHERE id = p_request_id;
    ELSE
      -- 还有后续步骤
      UPDATE public.borrow_requests SET status = 'partially_approved', updated_at = now()
      WHERE id = p_request_id;
    END IF;
  END IF;

  RETURN v_record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 删除 private schema 中的旧函数
DROP FUNCTION IF EXISTS private.process_approval(UUID, TEXT, TEXT);
