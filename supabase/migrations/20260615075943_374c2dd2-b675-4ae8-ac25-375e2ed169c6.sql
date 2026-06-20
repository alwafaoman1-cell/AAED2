
-- 1) Customer portal notes table
CREATE TABLE IF NOT EXISTS public.customer_portal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_order_id uuid NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  note text NOT NULL,
  customer_name text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by uuid,
  reviewed_at timestamptz,
  ip text,
  user_agent text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpn_tenant_status ON public.customer_portal_notes(tenant_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpn_job_order ON public.customer_portal_notes(job_order_id);

GRANT SELECT, INSERT, UPDATE ON public.customer_portal_notes TO authenticated;
GRANT ALL ON public.customer_portal_notes TO service_role;

ALTER TABLE public.customer_portal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read notes" ON public.customer_portal_notes
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "tenant update notes" ON public.customer_portal_notes
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER cpn_set_updated BEFORE UPDATE ON public.customer_portal_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_portal_notes;

-- 2) RPC: submit note (anon via token)
CREATE OR REPLACE FUNCTION public.submit_portal_note(
  p_token text, p_note text, p_customer_name text DEFAULT NULL,
  p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE;
BEGIN
  IF p_note IS NULL OR length(trim(p_note)) < 2 THEN RAISE EXCEPTION 'invalid_note'; END IF;
  IF length(p_note) > 2000 THEN RAISE EXCEPTION 'note_too_long'; END IF;
  SELECT * INTO v_tok FROM public.customer_portal_tokens WHERE token = p_token LIMIT 1;
  IF NOT FOUND OR v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  INSERT INTO public.customer_portal_notes (tenant_id, job_order_id, note, customer_name, ip, user_agent)
  VALUES (v_tok.tenant_id, v_tok.job_order_id, trim(p_note), NULLIF(trim(COALESCE(p_customer_name,'')),''), p_ip, p_user_agent);
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.submit_portal_note(text,text,text,text,text) TO anon, authenticated;

-- 3) RPC: review note
CREATE OR REPLACE FUNCTION public.review_portal_note(p_id uuid, p_decision text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  UPDATE public.customer_portal_notes
    SET status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    WHERE id = p_id AND tenant_id = public.get_user_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.review_portal_note(uuid,text) TO authenticated;

-- 4) Admin reopen signature
CREATE OR REPLACE FUNCTION public.admin_reopen_signature(p_job_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.get_user_role() <> 'admin' THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.customer_portal_tokens
    SET signature_data_url = NULL, signed_at = NULL, signer_name = NULL, signer_ip = NULL, signer_user_agent = NULL
    WHERE job_order_id = p_job_order_id AND tenant_id = public.get_user_tenant_id();
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reopen_signature(uuid) TO authenticated;
