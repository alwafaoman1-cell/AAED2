import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
const file='supabase/production/vehicle-visits/20261107_confirm_three_inside_workshop.sql';
const sql=readFileSync(file,'utf8').replace(/--[^\n]*/g,'');
describe('owner-confirmed, bounded historical custody correction',()=>{
  it('requires an active administrator or manager and exactly three distinct versioned targets',()=>{
    expect(sql).toContain('auth.uid()');expect(sql).toContain('public.get_user_tenant_id()');
    expect(sql).toContain("not in ('admin','manager')");expect(sql).toContain("p.account_status='active'");expect(sql).toContain('p.disabled_at is null');
    expect(sql).toContain('jsonb_array_length(targets)<>3');expect(sql).toContain("count(distinct value->>'entry_id')");
    expect(sql).toContain('expected_updated_at');expect(sql).toContain('CUSTODY_CORRECTION_STALE');expect(sql).toContain('for update');
  });
  it('retains original location in an audit and uses the existing guarded custody procedure',()=>{
    expect(sql).toContain("before_entry.vehicle_location='ساحة الورشة الخارجية'");
    expect(sql).toContain('to_jsonb(before_entry),to_jsonb(after_entry),target.reason');
    expect(sql).toContain('public.reconcile_vehicle_visit_custody(before_entry.id,target.reason)');
    expect(sql).not.toMatch(/update\s+public\.(insurance_claims|job_orders|vehicles)\b/i);
  });
  it('does not generate arrivals, visits, signatures, financial records or change historical dates',()=>{
    expect(sql).not.toMatch(/\b(delete\s+from|truncate|drop|alter\s+table|disable\s+trigger|disable\s+row\s+level|create\s+function)\b/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.(vehicle_entries|job_orders|sales_documents|insurance_invoices|expenses|vehicle_handover_records|vehicle_inspection_releases)\b/i);
    expect(sql).not.toMatch(/set\s+(arrival_date|arrival_time|customer_id|vehicle_id|status|archived_at|deleted_at)\s*=/i);
    for(const field of ['arrival_date','arrival_time','vehicle_id','customer_id','vehicle_location_bay'])expect(sql).toContain(`after_entry.${field} is distinct from before_entry.${field}`);
  });
});
