import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/production/vehicle-visits/20261107_owner_confirmed_vehicle_identity.sql','utf8').replace(/--[^\n]*/g,'');
describe('owner-confirmed three-vehicle identity correction',()=>{
  it('requires active authority, exact three before-images, tenant and full plate tuple',()=>{
    for(const part of ['auth.uid()','public.get_user_tenant_id()',"not in ('admin','manager')","p.account_status='active'",'p.disabled_at is null','jsonb_array_length(targets)<>3',"count(distinct value->>'entry_id')",'to_jsonb(e) is distinct from t.expected_entry','to_jsonb(c) is distinct from t.expected_claim','to_jsonb(j) is distinct from t.expected_order','v.plate_number is distinct from t.plate','v.plate_letters is distinct from t.letters','v.plate_country is distinct from t.country','for update'])expect(sql).toContain(part);
  });
  it('preserves signed identity, guards duplicates and retains an audit',()=>{
    for(const part of ['IDENTITY_CORRECTION_SIGNED_ENTRY_LOCKED','IDENTITY_CORRECTION_VISIT_AMBIGUOUS','IDENTITY_CORRECTION_LINK_CONFLICT','IDENTITY_CORRECTION_OPERATION_CONFLICT','vehicle_visit.owner_confirmed_identity_corrected',"'entry',before_e,'claim',before_c,'order',before_j"])expect(sql).toContain(part);
  });
  it('never merges registry, rewrites finance/history or forces closed-order links',()=>{
    expect(sql).not.toMatch(/\b(delete\s+from|truncate|drop|alter\s+table|disable\s+trigger|create\s+function)\b/i);
    expect(sql).not.toMatch(/(?:update|insert\s+into)\s+public\.(?:vehicles|expenses|sales_documents|insurance_invoices|vehicle_entry_signatures|vehicle_handover_records|vehicle_inspection_releases)\b/i);
    expect(sql).not.toMatch(/set\s+(?:customer_id|status|arrival_date|arrival_time|vehicle_snapshot|work_order_id|vehicle_entry_id|converted_work_order_id)\s*=/i);
    expect(sql).not.toContain('confirm_vehicle_entry_work_order_link(');
  });
});
