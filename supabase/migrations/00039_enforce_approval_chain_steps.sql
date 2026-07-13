-- An approver can only act on the first unresolved step assigned to them.
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
  v_approver_id UUID := auth.uid();
  v_current_step INTEGER;
  v_is_final BOOLEAN;
  v_requester_id UUID;
  v_request_number TEXT;
  v_next_approver_id UUID;
BEGIN
  IF v_approver_id IS NULL OR p_action NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid approval request';
  END IF;
  IF p_approver_id IS NOT NULL AND p_approver_id <> v_approver_id THEN
    RAISE EXCEPTION 'Approver identity does not match the signed-in user' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.borrow_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Borrow request was not found';
  END IF;

  SELECT MIN(step_level) INTO v_current_step
  FROM public.approval_records
  WHERE request_id = p_request_id AND acted_at IS NULL;

  SELECT * INTO v_record
  FROM public.approval_records
  WHERE request_id = p_request_id
    AND approver_id = v_approver_id
    AND step_level = v_current_step
    AND acted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No approval step is currently assigned to you' USING ERRCODE = '42501';
  END IF;

  SELECT requester_id, request_number INTO v_requester_id, v_request_number
  FROM public.borrow_requests WHERE id = p_request_id;

  IF p_action = 'rejected' THEN
    UPDATE public.approval_records
    SET action = 'rejected', comment = p_comment, acted_at = now()
    WHERE id = v_record.id;
    UPDATE public.approval_records
    SET action = 'cancelled', acted_at = now()
    WHERE request_id = p_request_id AND acted_at IS NULL;
    UPDATE public.borrow_request_items SET status = 'cancelled' WHERE request_id = p_request_id AND status = 'pending';
    UPDATE public.borrow_requests SET status = 'rejected', rejection_reason = p_comment, updated_at = now() WHERE id = p_request_id;
    INSERT INTO public.overdue_notifications (borrow_record_id, borrower_id, notification_type, notification_category, recipient_id, borrow_request_id, message, is_read)
    VALUES (NULL, v_requester_id, 'push', 'approval', v_requester_id, p_request_id, 'Approval rejected: ' || v_request_number, false);
    RETURN v_record.id;
  END IF;

  v_is_final := NOT EXISTS (
    SELECT 1 FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NULL AND id <> v_record.id
  );

  UPDATE public.approval_records
  SET action = 'approved', comment = p_comment, acted_at = now()
  WHERE id = v_record.id;

  IF v_is_final THEN
    PERFORM public.reserve_borrow_request(p_request_id);
    INSERT INTO public.overdue_notifications (borrow_record_id, borrower_id, notification_type, notification_category, recipient_id, borrow_request_id, message, is_read)
    VALUES (NULL, v_requester_id, 'push', 'approval', v_requester_id, p_request_id, 'Approval passed, samples reserved: ' || v_request_number, false);
  ELSE
    UPDATE public.borrow_requests SET status = 'partially_approved', updated_at = now() WHERE id = p_request_id;
    SELECT approver_id INTO v_next_approver_id
    FROM public.approval_records
    WHERE request_id = p_request_id AND acted_at IS NULL
    ORDER BY step_level
    LIMIT 1;
    IF v_next_approver_id IS NOT NULL THEN
      INSERT INTO public.overdue_notifications (borrow_record_id, borrower_id, notification_type, notification_category, recipient_id, borrow_request_id, message, is_read)
      VALUES (NULL, v_requester_id, 'push', 'approval', v_next_approver_id, p_request_id, 'New approval request: ' || v_request_number, false);
    END IF;
  END IF;
  RETURN v_record.id;
END;
$$;

-- Correct the request that was completed by the old administrator shortcut.
DO $$
DECLARE
  v_request_id UUID;
  v_general_manager_id UUID;
BEGIN
  SELECT id INTO v_request_id FROM public.borrow_requests WHERE request_number = 'BR-20260713-024';
  SELECT id INTO v_general_manager_id
  FROM public.profiles
  WHERE role = 'super_admin' AND status = 'active'
  ORDER BY created_at
  LIMIT 1;

  IF v_request_id IS NOT NULL AND v_general_manager_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.borrow_records WHERE request_id = v_request_id) = false THEN
    UPDATE public.approval_records
    SET approver_id = v_general_manager_id, action = NULL, comment = NULL, acted_at = NULL
    WHERE request_id = v_request_id AND step_level = 2;

    UPDATE public.borrow_requests
    SET status = 'partially_approved', updated_at = now()
    WHERE id = v_request_id;

    UPDATE public.borrow_request_items
    SET status = 'pending'
    WHERE request_id = v_request_id AND status = 'reserved';

    INSERT INTO public.overdue_notifications (
      borrow_record_id, borrower_id, notification_type, notification_category,
      recipient_id, borrow_request_id, message, is_read
    )
    SELECT NULL, br.requester_id, 'push', 'approval', v_general_manager_id, br.id,
      'New approval request: ' || br.request_number, false
    FROM public.borrow_requests br
    WHERE br.id = v_request_id
      AND NOT EXISTS (
        SELECT 1 FROM public.overdue_notifications n
        WHERE n.borrow_request_id = br.id
          AND n.recipient_id = v_general_manager_id
          AND n.notification_category = 'approval'
          AND n.notification_type = 'push'
          AND n.is_read = false
      );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.process_approval(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_approval(UUID, TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_approval(UUID, TEXT, TEXT, UUID) TO authenticated;
