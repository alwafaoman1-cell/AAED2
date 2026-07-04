-- Enhanced customer portal payload for /p/:shortCode.
-- Non-destructive: replaces only the public read RPC and does not expose UUIDs,
-- tenant ids, internal costs, supplier data, or workshop expenses.

CREATE OR REPLACE FUNCTION public.get_public_tracking(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tok public.customer_portal_tokens%ROWTYPE;
  v_jo  public.job_orders%ROWTYPE;
  v_veh public.vehicles%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_progress int;
  v_stage_key text;
  v_stage_ar text;
  v_stage_en text;
  v_stage_emoji text;
  v_pending_supps int := 0;
  v_photos jsonb := '[]'::jsonb;
  v_documents jsonb := '[]'::jsonb;
  v_supplements jsonb := '[]'::jsonb;
  v_invoices jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_replaced_parts jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
  v_feedback public.customer_feedback%ROWTYPE;
  v_eta date;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_tok
  FROM public.customer_portal_tokens
  WHERE token = trim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  IF v_tok.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error','revoked');
  END IF;

  SELECT * INTO v_jo
  FROM public.job_orders
  WHERE id::text = v_tok.job_order_id::text
    AND deleted_at IS NULL
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  SELECT * INTO v_veh FROM public.vehicles WHERE id::text = v_jo.vehicle_id::text;
  SELECT * INTO v_cust FROM public.customers WHERE id::text = v_jo.customer_id::text;

  IF v_jo.status = 'delivered' THEN
    v_stage_key := 'delivered'; v_stage_ar := 'تم التسليم'; v_stage_en := 'Delivered'; v_stage_emoji := '✅';
    v_progress := 100;
  ELSIF v_jo.status = 'completed' THEN
    v_stage_key := 'quality'; v_stage_ar := 'الفحص النهائي'; v_stage_en := 'Final check'; v_stage_emoji := '🛡️';
    v_progress := 90;
  ELSIF v_jo.status = 'in_progress' THEN
    v_stage_key := 'in_repair'; v_stage_ar := 'تحت الإصلاح'; v_stage_en := 'Under repair'; v_stage_emoji := '🔧';
    v_progress := 70;
  ELSIF v_jo.status = 'waiting_parts' THEN
    v_stage_key := 'parts_in_transit'; v_stage_ar := 'بانتظار القطع'; v_stage_en := 'Waiting parts'; v_stage_emoji := '🚚';
    v_progress := 55;
  ELSIF v_jo.insurance_claim_number IS NOT NULL AND v_jo.insurance_approved IS NOT TRUE THEN
    v_stage_key := 'waiting_insurance'; v_stage_ar := 'بانتظار الموافقة'; v_stage_en := 'Waiting approval'; v_stage_emoji := '⏳';
    v_progress := 35;
  ELSIF v_jo.insurance_approved IS TRUE AND v_jo.status IN ('received','inspection') THEN
    v_stage_key := 'insurance_approved'; v_stage_ar := 'تمت الموافقة'; v_stage_en := 'Approved'; v_stage_emoji := '✅';
    v_progress := 45;
  ELSIF v_jo.status = 'inspection' THEN
    v_stage_key := 'inspection'; v_stage_ar := 'الفحص والتقدير'; v_stage_en := 'Inspection & estimate'; v_stage_emoji := '🔍';
    v_progress := 20;
  ELSE
    v_stage_key := 'received'; v_stage_ar := 'استلام المركبة'; v_stage_en := 'Vehicle received'; v_stage_emoji := '📥';
    v_progress := 10;
  END IF;

  SELECT COUNT(*) INTO v_pending_supps
  FROM public.work_order_supplements
  WHERE job_order_id::text = v_jo.id::text
    AND status IN ('pending_customer','pending');

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p->>'id',
      'phase', COALESCE(p->>'phase', 'in_progress'),
      'caption', p->>'caption',
      'url', COALESCE(p->>'url', p->>'dataUrl'),
      'uploaded_at', COALESCE(p->>'uploadedAt', p->>'uploaded_at')
    )
  ), '[]'::jsonb) INTO v_photos
  FROM jsonb_array_elements(COALESCE(v_jo.photos, '[]'::jsonb)) p
  WHERE COALESCE((p->>'internal')::boolean, false) = false
    AND COALESCE((p->>'is_customer_visible')::boolean, true) = true
    AND COALESCE(p->>'url', p->>'dataUrl') IS NOT NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'title', COALESCE(d->>'title', d->>'name', 'Document'),
      'category', COALESCE(d->>'category', d->>'phase', 'file'),
      'url', COALESCE(d->>'url', d->>'publicUrl'),
      'type', COALESCE(d->>'type', 'file'),
      'uploaded_at', COALESCE(d->>'uploadedAt', d->>'uploaded_at')
    )
  ), '[]'::jsonb) INTO v_documents
  FROM jsonb_array_elements(COALESCE(v_jo.metadata->'documents', '[]'::jsonb)) d
  WHERE COALESCE((d->>'is_customer_visible')::boolean, false) = true
    AND COALESCE(d->>'url', d->>'publicUrl') IS NOT NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'description', s.description,
      'reason', s.notes,
      'quantity', s.quantity,
      'unit_price', s.unit_price,
      'vat', round((s.quantity * s.unit_price * 0.05)::numeric, 3),
      'total', round((s.quantity * s.unit_price * 1.05)::numeric, 3),
      'status', s.status,
      'sent_at', s.created_at,
      'decided_at', s.customer_decision_at,
      'approval_token', ar.token,
      'photos', COALESCE(s.photos, '[]'::jsonb)
    )
    ORDER BY s.created_at DESC
  ), '[]'::jsonb) INTO v_supplements
  FROM public.work_order_supplements s
  LEFT JOIN LATERAL (
    SELECT r.token
    FROM public.supplement_approval_requests r
    WHERE r.job_order_id::text = s.job_order_id::text
      AND s.id::text = ANY(r.supplement_ids::text[])
      AND r.status = 'pending'
      AND r.expires_at > now()
    ORDER BY r.created_at DESC
    LIMIT 1
  ) ar ON true
  WHERE s.job_order_id::text = v_jo.id::text;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'number', sd.doc_number,
      'date', sd.date,
      'subtotal', sd.subtotal,
      'vat', sd.tax_total,
      'total', sd.total,
      'paid', sd.paid_amount,
      'balance', sd.balance_due,
      'status', sd.status,
      'visible', true
    )
    ORDER BY sd.date DESC, sd.created_at DESC
  ), '[]'::jsonb) INTO v_invoices
  FROM public.sales_documents sd
  WHERE sd.work_order_id::text = v_jo.id::text
    AND sd.doc_type = 'invoice'
    AND sd.status <> 'cancelled';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'number', sp.payment_number,
      'date', sp.date,
      'amount', sp.amount,
      'method', sp.method,
      'reference', sp.reference
    )
    ORDER BY sp.date DESC, sp.created_at DESC
  ), '[]'::jsonb) INTO v_payments
  FROM public.sales_payments sp
  JOIN public.sales_documents sd ON sd.id::text = sp.sales_document_id::text
  WHERE sd.work_order_id::text = v_jo.id::text
    AND sd.doc_type = 'invoice'
    AND sd.status <> 'cancelled';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'name', COALESCE(p->>'name', p->>'title', p->>'description'),
      'status', COALESCE(p->>'status', CASE WHEN COALESCE((p->>'fulfilled')::boolean, false) THEN 'تم الاستبدال' ELSE 'بانتظار القطعة' END),
      'type', COALESCE(p->>'type', p->>'partType', 'غير محدد'),
      'quantity', COALESCE((p->>'quantity')::numeric, 1),
      'image_url', COALESCE(p->>'image_url', p->>'imageUrl'),
      'note', p->>'notes'
    )
  ), '[]'::jsonb) INTO v_replaced_parts
  FROM jsonb_array_elements(COALESCE(v_jo.parts_needed, '[]'::jsonb)) p
  WHERE COALESCE((p->>'internal')::boolean, false) = false;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'message', n.note,
      'created_at', n.submitted_at,
      'source', 'customer_portal'
    )
    ORDER BY n.submitted_at DESC
  ), '[]'::jsonb) INTO v_messages
  FROM public.customer_portal_notes n
  WHERE n.job_order_id::text = v_jo.id::text
    AND n.status IN ('approved','pending');

  v_eta := v_jo.estimated_completion;

  SELECT * INTO v_feedback
  FROM public.customer_feedback
  WHERE job_order_id::text = v_jo.id::text
  LIMIT 1;

  RETURN jsonb_build_object(
    'order_number', v_jo.order_number,
    'entry_date', v_jo.entry_date,
    'eta', v_eta,
    'progress_pct', v_progress,
    'stage', jsonb_build_object(
      'key', v_stage_key,
      'label_ar', v_stage_ar,
      'label_en', v_stage_en,
      'emoji', v_stage_emoji,
      'updated_at', v_jo.updated_at
    ),
    'is_delivered', (v_jo.status = 'delivered'),
    'vehicle', jsonb_build_object(
      'plate', trim(concat_ws(' ', v_veh.plate_letters, v_veh.plate_number)),
      'brand', v_veh.brand,
      'model', v_veh.model,
      'year', v_veh.year,
      'color', v_veh.color,
      'vin', CASE WHEN COALESCE((v_jo.metadata->>'show_vin_to_customer')::boolean, false) THEN v_veh.vin_number ELSE NULL END
    ),
    'customer_name', v_cust.name,
    'customer_phone', v_cust.phone,
    'workshop_name', (SELECT name FROM public.tenants WHERE id = v_jo.tenant_id),
    'workshop_phone', NULL,
    'whatsapp_phone', v_cust.phone,
    'work_order', jsonb_build_object(
      'type', v_jo.work_order_type,
      'status', v_jo.status,
      'description', v_jo.description,
      'expected_delivery', v_jo.estimated_completion
    ),
    'pending_approvals', v_pending_supps,
    'supplements', v_supplements,
    'invoices', v_invoices,
    'payments', v_payments,
    'replaced_parts', v_replaced_parts,
    'photos', v_photos,
    'documents', v_documents,
    'messages', v_messages,
    'feedback', CASE WHEN v_feedback.id IS NOT NULL THEN
      jsonb_build_object('rating', v_feedback.rating, 'comment', v_feedback.comment, 'created_at', v_feedback.created_at)
    ELSE NULL END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_public_tracking(text) TO anon, authenticated;
