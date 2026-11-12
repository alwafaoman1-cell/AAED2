// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {isVehicleVisitAwaitingArrival,newVehicleVisitLocation,vehicleVisitActionTime} from '@/lib/vehicleVisitIntake';
import {getVehicleCenterTab,getVehicleVisitNextBlocker,projectClaimWithoutEntry,resolveVehicleVisit} from '@/lib/vehicleVisitLifecycle';

const base={id:'entry',vehicle_id:'vehicle',arrival_date:'2026-11-07',arrival_time:'08:00',status:'Issued',vehicle_location:'مع العميل',vehicle_condition:{visit_purpose:'inspection',arrival_confirmation:'pending'}};
describe('unified vehicle workspace custody and terminal projection',()=>{
  it('does not submit the start of the minute before a just-confirmed approval',()=>{
    expect(vehicleVisitActionTime('2026-11-07T12:30','2026-11-07T12:30',new Date('2026-11-07T12:30:48.800Z'))).toBe('2026-11-07T12:30:48.800Z');
    expect(vehicleVisitActionTime('2026-07-01T08:00','2026-11-07T12:30')).toBe(new Date('2026-07-01T08:00').toISOString());
  });
  it('prepares inspection with customer custody, and workshop intake inside',()=>{
    expect(newVehicleVisitLocation('inspection')).toBe('مع العميل');expect(newVehicleVisitLocation('workshop')).toBe('داخل الورشة');
  });
  it('does not invent a release, handover, or review conflict for a prepared inspection',()=>{
    const visit=resolveVehicleVisit(base,null,false);
    expect(visit.reviewReason).toBeNull();expect(visit.stage).toBe('arrived');expect(visit.hasFinalHandover).toBe(false);
    expect(getVehicleCenterTab(visit)).toBe('awaiting_arrival');
  });
  it.each([undefined,'confirmed',''])('does not reinterpret an undocumented legacy exit with marker %s',marker=>{
    const entry={...base,vehicle_condition:{visit_purpose:'inspection',arrival_confirmation:marker}};
    expect(isVehicleVisitAwaitingArrival(entry)).toBe(false);
    expect(resolveVehicleVisit(entry,null,false).reviewReason).toBe('exit_without_signed_release');
  });
  it('never lets a preparation marker conceal conflicting claim custody',()=>{
    const entry={...base,insurance_claim_id:'claim',claim:{id:'claim',vehicle_id:'vehicle',status:'pending',vehicle_presence_status:'in_workshop'}};
    expect(resolveVehicleVisit(entry,null,false).reviewReason).toBe('custody_conflict');
  });
  it('keeps actual arrivals with no financial action in Arrived',()=>{
    const visit=resolveVehicleVisit({...base,vehicle_location:'داخل الورشة',insurance_company_id:'company',vehicle_condition:{visit_purpose:'workshop'}},null,false);
    expect(visit.stage).toBe('arrived');expect(getVehicleCenterTab(visit)).toBe('in_workshop');
    expect(getVehicleVisitNextBlocker('approved',visit.entry,()=>true,false)).toBe('claimApprovalRequired');
  });
  it('shows cancelled claim-only history in Cancelled while keeping the missing-entry warning',()=>{
    const visit=projectClaimWithoutEntry({id:'claim',vehicle_id:'vehicle',status:'cancelled',created_at:'2026-11-07T08:00Z'},null);
    expect(getVehicleCenterTab(visit)).toBe('cancelled');expect(visit.reviewReason).toBe('claim_without_entry');expect(visit.entry.entry_number).toBe('');
  });
  it('keeps cancelled-with-active-order warnings without inventing delivery',()=>{
    const visit=resolveVehicleVisit({...base,vehicle_location:'داخل الورشة',insurance_claim_id:'claim',claim:{id:'claim',vehicle_id:'vehicle',status:'cancelled'},work_order_id:'order',work_order:{id:'order',vehicle_id:'vehicle',claim_id:'claim',work_order_type:'insurance',status:'in_progress'}},null,false);
    expect(getVehicleCenterTab(visit)).toBe('cancelled');expect(visit.reviewReason).toBe('cancelled_with_active_work_order');expect(visit.hasFinalHandover).toBe(false);
  });
  it('uses one stage controller for quick actions, not a second transition implementation',()=>{
    const quick=readFileSync('src/pages/vehicle-entry/VehicleVisitQuickActionDialog.tsx','utf8');
    expect(quick).toContain('<VehicleVisitControlPanel');expect(quick).not.toContain('advanceVehicleVisit');expect(quick).not.toContain('visitAction=approve');
  });
  it('retains arrival evidence in claim/work-order badge and approval-context reads',()=>{
    const source=readFileSync('src/lib/vehicleVisitLifecycle.ts','utf8');
    const linked=source.slice(source.indexOf('export async function getLinkedVehicleVisit'));
    expect(linked).toContain('vehicle_location,vehicle_condition,status');
  });
  it('keeps explicit arrival behind role, CAS, idempotency and history guards without broad data repair',()=>{
    const sql=readFileSync('supabase/migrations/20261107115803_vehicle_visit_workspace_intake_and_projection.sql','utf8');
    for(const guard of ['p_expected_updated_at','arrival_request_revision','account_status=\'active\'','VEHICLE_VISIT_LINK_REVIEW_REQUIRED','vehicle_visit_transitions','vehicle_entry_audit_logs','from public,anon,authenticated'])expect(sql).toContain(guard);
    expect(sql).not.toMatch(/update\s+public\.(expenses|sales_documents|insurance_invoices|claim_payments)/i);
  });
});
