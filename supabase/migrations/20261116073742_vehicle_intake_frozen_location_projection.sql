-- Publish only the location already captured in the signed intake snapshot.
-- Current custody changes never rewrite or replace this historical evidence.
-- CREATE OR REPLACE retains the existing function owner and execute grants.
CREATE OR REPLACE FUNCTION public.customer_vehicle_portal_document(p_token text, p_session text, p_entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.vehicle_customer_portals;e public.vehicle_entries;r public.vehicle_entry_signed_revisions;
 c public.vehicle_entry_custody_receipts;snapshot jsonb;d jsonb;technical jsonb;technical_form jsonb;safe_technical jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null;
 if not found then raise exception 'PORTAL_DOCUMENT_UNAVAILABLE';end if;
 select sr.* into r from public.vehicle_entry_signed_revisions sr where sr.vehicle_entry_id=e.id and sr.tenant_id=p.tenant_id and sr.revision=e.intake_revision;
 select * into c from public.vehicle_entry_custody_receipts where revision_id=r.id and tenant_id=p.tenant_id;
 if r.id is null or c.id is null then raise exception 'PORTAL_SIGNED_DOCUMENT_REQUIRED';end if;
 technical:=r.snapshot->'vehicle_technical_declaration';
 technical_form:=technical->'form_data';
 if jsonb_typeof(technical)='object' and nullif(technical->>'id','') is not null and jsonb_typeof(technical_form)='object' then
  safe_technical:=jsonb_build_object('id',technical->'id','revision',technical->'revision','form_data',jsonb_build_object(
   'claim_number',technical_form->'claim_number','registration_number',technical_form->'registration_number','make_model',technical_form->'make_model',
   'non_gcc_vehicle',technical_form->'non_gcc_vehicle','towing',technical_form->'towing','cranking',technical_form->'cranking',
   'engine_oil_level',technical_form->'engine_oil_level','radiator_coolant',technical_form->'radiator_coolant','engine_other_remarks',technical_form->'engine_other_remarks',
   'gear_body_crack',technical_form->'gear_body_crack','gear_oil_leak',technical_form->'gear_oil_leak','gear_other_remarks',technical_form->'gear_other_remarks',
   'previous_improper_repairs',technical_form->'previous_improper_repairs','previous_improper_details',technical_form->'previous_improper_details',
   'airbag_warning',technical_form->'airbag_warning','engine_warning',technical_form->'engine_warning','atm_warning',technical_form->'atm_warning','warning_other',technical_form->'warning_other',
   'chassis_status',technical_form->'chassis_status','chassis_damage_lh',technical_form->'chassis_damage_lh','chassis_damage_rh',technical_form->'chassis_damage_rh',
   'chassis_replace_lh',technical_form->'chassis_replace_lh','chassis_replace_rh',technical_form->'chassis_replace_rh','chassis_notes',technical_form->'chassis_notes',
   'floor_deformation',technical_form->'floor_deformation','body_deformation',technical_form->'body_deformation','body_floor_details',technical_form->'body_floor_details',
   'accessories_modification',technical_form->'accessories_modification','ppe',technical_form->'ppe','accessories_details',technical_form->'accessories_details',
   'other_observations',technical_form->'other_observations','garage_name',technical_form->'garage_name','authorized_person',technical_form->'authorized_person',
   'signer_role',technical_form->'signer_role','signature_data_url',technical_form->'signature_data_url','date',technical_form->'date'));
 end if;
 snapshot:=jsonb_build_object('id',e.id,'entry_number',r.snapshot->'entry_number','arrival_date',r.snapshot->'arrival_date','arrival_time',r.snapshot->'arrival_time','vehicle_location',r.snapshot->'vehicle_location','vehicle_location_bay',r.snapshot->'vehicle_location_bay','customer_snapshot',r.snapshot->'customer_snapshot','vehicle_snapshot',r.snapshot->'vehicle_snapshot','vehicle_condition',r.snapshot->'vehicle_condition','vehicle_contents',r.snapshot->'vehicle_contents','delivered_by',r.snapshot->'delivered_by','received_by_name',r.snapshot->'received_by_name','declaration_ar',r.snapshot->'declaration_ar','declaration_en',r.snapshot->'declaration_en','vehicle_entry_signatures',r.snapshot->'vehicle_entry_signatures','damage_marks',r.snapshot->'damage_marks','damage_map',r.snapshot->'damage_map','claim',jsonb_build_object('claim_number',r.snapshot#>>'{claim,claim_number}'),'work_order',jsonb_build_object('order_number',r.snapshot#>>'{work_order,order_number}'),'insurance_snapshot',jsonb_build_object('claim_number',r.snapshot#>>'{insurance_snapshot,claim_number}','company_name',r.snapshot#>>'{insurance_snapshot,company_name}','is_insurance_related',r.snapshot#>'{insurance_snapshot,is_insurance_related}','lpo_number',r.snapshot#>>'{insurance_snapshot,lpo_number}'),'vehicle_media','[]'::jsonb,'custody_print_settings',r.snapshot->'custody_print_settings','vehicle_technical_declaration',safe_technical);
 if c.status='used' then
  select jsonb_build_object('handover_id',h.id,'handover_number',h.receipt_number,'recipient_name',h.recipient_name,'delivered_at',h.delivered_at,'confirmed_at',h.finalized_at,'delivered_by_name',h.workshop_representative,'signature_data_url',h.signature_data_url,'review_notes',h.work_summary)
  into d from public.vehicle_handover_records h join public.vehicle_customer_delivery_approvals a on a.handover_id=h.id and a.tenant_id=p.tenant_id
  where h.id=c.handover_id and h.tenant_id=p.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized';
 end if;
 return jsonb_build_object('receipt',to_jsonb(c),'entry',snapshot,'revision',r.revision,'delivery_confirmation',d,'review_context',app_private.review_visit_context(e.id));
end $function$;

