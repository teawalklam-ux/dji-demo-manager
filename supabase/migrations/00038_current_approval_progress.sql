-- Return approval progress only to the person currently allowed to approve it.
-- This keeps previous approvers' comments out of ordinary request queries.
CREATE OR REPLACE FUNCTION public.get_current_approval_progress(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_request_status TEXT;
  v_current RECORD;
  v_previous RECORD;
  v_step_label TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;
  SELECT status INTO v_request_status FROM public.borrow_requests WHERE id = p_request_id;
  IF v_request_status NOT IN ('pending', 'partially_approved') THEN
    RAISE EXCEPTION 'This approval flow is no longer pending' USING ERRCODE = '22023';
  END IF;

  SELECT ar.step_level, ar.approver_id, p.display_name
  INTO v_current
  FROM public.approval_records ar
  JOIN public.profiles p ON p.id = ar.approver_id
  WHERE ar.request_id = p_request_id
    AND ar.acted_at IS NULL
  ORDER BY ar.step_level
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending approval step was found' USING ERRCODE = '22023';
  END IF;

  IF v_role NOT IN ('super_admin', 'admin') AND v_current.approver_id <> v_user_id THEN
    RAISE EXCEPTION 'You are not the current approver for this request' USING ERRCODE = '42501';
  END IF;

  SELECT step->>'label' INTO v_step_label
  FROM public.approval_chains ac
  CROSS JOIN LATERAL jsonb_array_elements(ac.steps) AS step
  WHERE ac.id = (
    SELECT chain_id FROM public.approval_records
    WHERE request_id = p_request_id
    ORDER BY step_level
    LIMIT 1
  )
    AND (step->>'level')::INTEGER = v_current.step_level
  LIMIT 1;

  SELECT ar.step_level, ar.action, ar.comment, ar.acted_at, p.display_name
  INTO v_previous
  FROM public.approval_records ar
  JOIN public.profiles p ON p.id = ar.approver_id
  WHERE ar.request_id = p_request_id
    AND ar.step_level < v_current.step_level
    AND ar.acted_at IS NOT NULL
  ORDER BY ar.step_level DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'current_step', jsonb_build_object(
      'step_level', v_current.step_level,
      'approver_id', v_current.approver_id,
      'approver_name', v_current.display_name,
      'step_label', v_step_label
    ),
    'previous_step', CASE WHEN v_previous.step_level IS NULL THEN NULL ELSE jsonb_build_object(
      'step_level', v_previous.step_level,
      'approver_name', v_previous.display_name,
      'action', v_previous.action,
      'comment', v_previous.comment,
      'acted_at', v_previous.acted_at
    ) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_approval_progress(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_approval_progress(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_current_approval_progress(UUID) TO authenticated;
