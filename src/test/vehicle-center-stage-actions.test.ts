// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {getVehicleVisitNextBlocker} from '@/lib/vehicleVisitLifecycle';
import i18n from '@/i18n';
import '@/lib/i18n/vehicleVisitWorkspace';
const entry={vehicle_location:'داخل الورشة',work_order:{id:'order',status:'completed',work_order_type:'general_customer',vehicle_presence_status:'in_workshop'}};
describe('center stage and custody actions',()=>{
 it('requires a canonical handover for ready vehicles; completion alone is not physical delivery',()=>{
  expect(getVehicleVisitNextBlocker('delivered',entry,()=>true,false)).toBe('signedHandoverRequired');
 });
 it('identifies historical ready/order conflicts without rewriting their completion date',()=>{
  const conflicted={...entry,work_order:{...entry.work_order,status:'received',work_completed_at:'2026-07-30T00:00:00Z'}};
  expect(getVehicleVisitNextBlocker('delivered',conflicted,()=>true,false)).toBe('deliveryWorkOrderConflict');
  expect(conflicted.work_order.work_completed_at).toBe('2026-07-30T00:00:00Z');expect(conflicted.work_order.status).toBe('received');
 });
 it('does not bypass completion permissions for the new handover action',()=>{
  expect(getVehicleVisitNextBlocker('delivered',entry,()=>false,false)).toBe('completionPermissionRequired');
 });
 it('provides localized workspace labels before a quick action opens',()=>{
  expect(i18n.t('vehicleVisitWorkspace.visibleStage',{lng:'en'})).toBe('Visible stages');
  expect(i18n.t('vehicleVisitWorkspace.allStages',{lng:'ar'})).toBe('جميع المراحل');
 });
 it('restricts the paper finalizer to active tenant staff and keeps the common custody helper private',()=>{
  const sql=readFileSync('supabase/migrations/20261108090705_vehicle_visit_paper_release_and_custody.sql','utf8');
  expect(sql).toContain("p.account_status='active' and p.disabled_at is null");
  expect(sql).toContain('r.updated_at is distinct from p_expected_updated_at');
  expect(sql).toContain('signature_data_url=null');
  expect(sql).toContain('revoke all on function app_private.apply_inspection_release_custody(uuid) from public,anon,authenticated');
  expect(sql).toContain('perform app_private.apply_inspection_release_custody(v_release.id)');
  expect(sql).not.toMatch(/update public\.(expenses|sales_documents|insurance_invoices|accounting_)/i);
 });
 it('records actual returns with a guarded canonical function change instead of a historical backfill',()=>{
  const sql=readFileSync('supabase/migrations/20261108091643_vehicle_visit_return_event_timeline.sql','utf8');
  expect(sql).toContain('INSPECTION_RETURN_DEFINITION_REVIEW_REQUIRED');expect(sql).toContain("'temporary_return'");
  expect(sql).toContain('v_now:=clock_timestamp()');
 });
});
