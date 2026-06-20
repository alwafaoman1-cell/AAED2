
DROP POLICY IF EXISTS "expense_categories restrict insert" ON public.expense_categories;
DROP POLICY IF EXISTS "expense_categories restrict update" ON public.expense_categories;
DROP POLICY IF EXISTS "expense_categories restrict delete" ON public.expense_categories;
DROP POLICY IF EXISTS "cns restrict insert" ON public.customer_notification_settings;
DROP POLICY IF EXISTS "cns restrict update" ON public.customer_notification_settings;
DROP POLICY IF EXISTS "cns restrict delete" ON public.customer_notification_settings;
DROP POLICY IF EXISTS "profiles restrict role change" ON public.profiles;

CREATE POLICY "expense_categories restrict insert" ON public.expense_categories AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "expense_categories restrict update" ON public.expense_categories AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]))
WITH CHECK (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "expense_categories restrict delete" ON public.expense_categories AS RESTRICTIVE
FOR DELETE TO authenticated
USING (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "cns restrict insert" ON public.customer_notification_settings AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "cns restrict update" ON public.customer_notification_settings AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]))
WITH CHECK (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "cns restrict delete" ON public.customer_notification_settings AS RESTRICTIVE
FOR DELETE TO authenticated
USING (public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE OR REPLACE FUNCTION public.review_portal_note(p_id uuid, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin'::app_role, 'manager'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  UPDATE public.customer_portal_notes
    SET status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE id = p_id AND tenant_id = public.get_user_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.submit_work_order_signature(
  p_token text, p_signature text, p_signer_name text,
  p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF p_signature IS NULL OR length(p_signature) < 100 THEN RAISE EXCEPTION 'invalid_signature'; END IF;
  IF length(p_signature) > 500000 THEN RAISE EXCEPTION 'signature_too_large'; END IF;
  IF length(COALESCE(p_signer_name,'')) > 200 THEN RAISE EXCEPTION 'signer_name_too_long'; END IF;
  SELECT * INTO v_tok FROM public.customer_portal_tokens WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v_tok.signed_at IS NOT NULL THEN RAISE EXCEPTION 'already_signed'; END IF;
  UPDATE public.customer_portal_tokens
     SET signature_data_url = p_signature,
         signer_name = NULLIF(trim(COALESCE(p_signer_name,'')), ''),
         signer_ip = p_ip, signer_user_agent = p_user_agent, signed_at = now()
   WHERE id = v_tok.id;
  RETURN jsonb_build_object('ok', true, 'signed_at', now());
END $$;

DROP POLICY IF EXISTS "Supervisor insert expenses" ON public.expenses;

CREATE POLICY "profiles restrict role change" ON public.profiles AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (true)
WITH CHECK (
  role = (SELECT p.role FROM public.profiles p WHERE p.id = profiles.id)
  OR public.get_user_role() = 'admin'::app_role
);
