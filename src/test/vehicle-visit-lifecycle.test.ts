// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveClaimOnlyStage, getVehicleVisitBillingKind, projectClaimWithoutEntry, resolveVehicleVisit, type VehicleVisitWorkflow } from "@/lib/vehicleVisitLifecycle";
import { getVehicleEntryPresence } from "@/lib/vehicleEntryService";

const vehicle = "vehicle-1";
const base = { id: "entry-1", vehicle_id: vehicle, arrival_date: "2026-10-20", arrival_time: "08:00", vehicle_location: "داخل الورشة", status: "Received" };
const workflow = (stage: VehicleVisitWorkflow["stage"], review_reason: string | null = null): VehicleVisitWorkflow => ({
  entry_id: base.id, tenant_id: "tenant-1", vehicle_id: vehicle, stage, revision: 2,
  review_reason, changed_at: "2026-10-20T10:00:00Z", changed_by: null,
});

describe("vehicle visit stage projection", () => {
  it("uses claim registration as the operational entry date without inventing a signed receipt", () => {
    const card = projectClaimWithoutEntry({
      id: "claim-1", claim_number: "C/2026/1", status: "pending", vehicle_id: vehicle,
      vehicle_presence_status: "with_customer", workshop_arrival_date: null,
      created_at: "2026-10-20T21:30:00Z",
    }, null);
    expect(card.entry._claimOnly).toBe(true);
    expect(card.entry.entry_number).toBe("");
    expect(card.entry.arrival_date).toBe("2026-10-21");
    expect(card.entry.arrival_time).toBe("01:30");
    expect(card.entry._arrivalSource).toBe("claim_registration");
    expect(card.stage).toBe("arrived");
    expect(card.reviewReason).toBe("claim_without_entry");
    expect(getVehicleEntryPresence(card.entry)).toBe("with_customer");
  });
  it("prefers a recorded arrival and does not mistake the accident date for entry", () => {
    const card = projectClaimWithoutEntry({
      id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "in_workshop",
      workshop_arrival_date: "2026-07-01T20:30:00Z", created_at: "2026-09-01T10:00:00Z",
      incident_date: "2026-06-01T00:00:00Z",
    }, null);
    expect(card.entry.arrival_date).toBe("2026-07-02");
    expect(card.entry._arrivalSource).toBe("workshop_arrival_date");
    expect(card.stage).toBe("approved");
  });
  it("sorts cancelled, delivered, and active claim-only visits by evidence, not payment alone", () => {
    const claim = { id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "in_workshop" };
    const order = { claim_id: claim.id, vehicle_id: vehicle, work_order_type: "insurance", status: "in_progress" };
    expect(deriveClaimOnlyStage({ ...claim, status: "cancelled" }, null)).toBe("cancelled");
    expect(deriveClaimOnlyStage(claim, order)).toBe("in_progress");
    expect(deriveClaimOnlyStage({ ...claim, status: "paid" }, null)).toBe("approved");
    expect(deriveClaimOnlyStage({ ...claim, vehicle_presence_status: "with_customer", delivered_at: "2026-10-21T10:00:00Z" }, { ...order, status: "delivered" })).toBe("delivered");
    expect(deriveClaimOnlyStage({ ...claim, status: "cancelled" }, order)).toBe("needs_review");
    expect(deriveClaimOnlyStage(claim, { ...order, vehicle_id: "other" })).toBe("needs_review");
    expect(deriveClaimOnlyStage({ ...claim, vehicle_presence_status: "with_customer" }, order)).toBe("needs_review");
  });
  it("looks for both original and converted claim links before creating an entry", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/vehicleEntryService.ts"), "utf8");
    const lookup = source.slice(source.indexOf("export async function getVehicleEntryByClaimId"),
      source.indexOf("export async function ensureVehicleEntryForClaim"));
    expect(lookup).toContain("converted_claim_id.eq.");
    expect(lookup).toContain('eq("id", claim.vehicle_entry_id)');
    expect(lookup).toContain('entry.vehicle_id !== claim.vehicle_id');
    expect(lookup).toContain('VEHICLE_ENTRY_CLAIM_BACKLINK_REVIEW_REQUIRED');
  });
  it("quarantines a claim backlink that was never saved on the entry", () => {
    const projected = resolveVehicleVisit({ ...base, claim: {
      id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "in_workshop",
    }, __inferredClaimLink: true }, null, false);
    expect(projected).toMatchObject({ stage: "needs_review", reviewReason: "claim_link_conflict" });
  });
  it("preserves the persisted stage of a healthy visit", () => {
    expect(resolveVehicleVisit(base, workflow("approved"), false).stage).toBe("approved");
  });
  it("does not classify a paper delivery as a completed handover", () => {
    const delivered = { ...base, vehicle_location: "مع العميل", work_order_id: "order-1", work_order: { id: "order-1", vehicle_id: vehicle, status: "delivered", vehicle_delivered_at: "2026-10-22T10:00:00Z", vehicle_presence_status: "with_customer" } };
    const projected = resolveVehicleVisit(delivered, workflow("ready"), false);
    expect(projected.stage).toBe("needs_review");
    expect(projected.reviewReason).toBe("delivery_without_signed_handover");
    expect(resolveVehicleVisit(delivered, workflow("delivered"), true).stage).toBe("delivered");
  });
  it("keeps inspection inside until a signed temporary release changes custody", () => {
    expect(resolveVehicleVisit({ ...base, vehicle_condition: { visit_purpose: "inspection" } }, workflow("arrived"), false).stage).toBe("arrived");
    expect(resolveVehicleVisit({ ...base, vehicle_location: "مع العميل" }, workflow("arrived"), false).stage).toBe("needs_review");
    expect(resolveVehicleVisit({ ...base, vehicle_location: "مع العميل" }, workflow("arrived"), false, true).stage).toBe("arrived");
  });
  it("quarantines mismatched links and regression flags without changing the workflow", () => {
    expect(resolveVehicleVisit({ ...base, work_order_id: "other", work_order: { vehicle_id: "different" } }, workflow("in_progress"), false).stage).toBe("needs_review");
    expect(resolveVehicleVisit(base, workflow("in_progress", "source_regressed"), false).stage).toBe("needs_review");
  });
  it("shows an order inferred from the same claim and vehicle as needing link review, not as a confirmed visit", () => {
    const inferred = { ...base, insurance_claim_id: "claim-1", claim: {
      id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "in_workshop",
    }, work_order: {
      id: "order-1", vehicle_id: vehicle, claim_id: "claim-1", work_order_type: "insurance",
      status: "received", vehicle_presence_status: "in_workshop",
    }, __inferredOrderLink: true };
    expect(resolveVehicleVisit(inferred, workflow("approved"), false)).toMatchObject({
      stage: "needs_review", reviewReason: "work_order_link_conflict",
    });
  });
  it("keeps historical entries as a read-only source projection", () => {
    expect(resolveVehicleVisit({ ...base, claim: { status: "approved" } }, null, false).stage).toBe("approved");
    expect(resolveVehicleVisit({ ...base, work_order: { status: "completed" } }, null, false).stage).toBe("ready");
  });
  it("projects legacy milestones using the same evidence precedence as the database", () => {
    expect(resolveVehicleVisit({ ...base, claim: { status: "pending", insurance_approved_at: "2026-10-20T10:00:00Z" } }, null, false).stage).toBe("approved");
    expect(resolveVehicleVisit({ ...base, work_order: { status: "received", work_started_at: "2026-10-20T11:00:00Z" } }, null, false).stage).toBe("in_progress");
    expect(resolveVehicleVisit({ ...base, work_order: { status: "in_progress", work_completed_at: "2026-10-20T12:00:00Z" } }, null, false).stage).toBe("ready");
    expect(resolveVehicleVisit({ ...base, claim: { status: "approved", work_started_at: "2026-10-20T11:00:00Z", work_completed_at: "2026-10-20T12:00:00Z" } }, null, false).stage).toBe("ready");
  });
  it("keeps insurance entries without a linked claim out of the cash approval path", () => {
    const unlinkedInsurance = { ...base, insurance_snapshot: { claim_number: "C/2026/1" } };
    expect(getVehicleVisitBillingKind(unlinkedInsurance)).toBe("insurance");
    expect(resolveVehicleVisit(unlinkedInsurance, null, false)).toMatchObject({
      stage: "needs_review", reviewReason: "insurance_claim_required",
    });
    expect(getVehicleVisitBillingKind({ ...base, work_order: { work_order_type: "general_customer" } })).toBe("cash");
  });
  it("requires explicit custody review when the entry and insurance claim disagree", () => {
    const conflicting = { ...base, insurance_claim_id: "claim-1", claim: {
      id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "with_customer",
    } };
    expect(resolveVehicleVisit(conflicting, null, false)).toMatchObject({
      stage: "needs_review", reviewReason: "custody_conflict",
    });
    const reconciled = { ...conflicting, claim: { ...conflicting.claim, vehicle_presence_status: "in_workshop" } };
    expect(resolveVehicleVisit(reconciled, null, false).stage).toBe("approved");
  });
  it("shows a historical work milestone while retaining the blocking custody review", () => {
    const conflicting = { ...base, insurance_claim_id: "claim-1", claim: {
      id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "with_customer",
    }, work_order_id: "order-1", work_order: {
      id: "order-1", vehicle_id: vehicle, claim_id: "claim-1", work_order_type: "insurance",
      status: "in_progress", vehicle_presence_status: "with_customer",
    } };
    expect(resolveVehicleVisit(conflicting, workflow("in_progress"), false)).toMatchObject({
      stage: "needs_review", operationalStage: "in_progress", reviewReason: "custody_conflict",
    });
    const delivered = { ...conflicting, work_order: {
      ...conflicting.work_order, status: "delivered", vehicle_delivered_at: "2026-10-22T10:00:00Z",
    } };
    expect(resolveVehicleVisit(delivered, workflow("ready"), false)).toMatchObject({
      stage: "needs_review", operationalStage: "delivered",
    });
    expect(resolveVehicleVisit({ ...conflicting, claim: { ...conflicting.claim, status: "cancelled" } },
      workflow("in_progress"), false)).toMatchObject({
      stage: "needs_review", operationalStage: "cancelled", reviewReason: "cancelled_with_active_work_order",
    });
  });
  it("does not treat a delivery timestamp from before this entry as delivery of this visit", () => {
    const row = { ...base, insurance_claim_id: "claim-1", claim: {
      id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "with_customer",
      delivered_at: "2026-10-18T12:00:00Z",
    } };
    expect(resolveVehicleVisit(row, null, false)).toMatchObject({
      stage: "needs_review", operationalStage: "needs_review", reviewReason: "custody_conflict",
    });
  });
  it("quarantines a cash work order linked to an insurance claim", () => {
    const mismatched = { ...base, insurance_claim_id: "claim-1", claim: {
      id: "claim-1", vehicle_id: vehicle, status: "approved", vehicle_presence_status: "in_workshop",
    }, work_order_id: "order-1", work_order: {
      id: "order-1", vehicle_id: vehicle, status: "received", vehicle_presence_status: "in_workshop",
      work_order_type: "general_customer", claim_id: null,
    } };
    expect(resolveVehicleVisit(mismatched, null, false)).toMatchObject({
      stage: "needs_review", reviewReason: "work_order_channel_conflict",
    });
  });
  it("does not present a cancelled claim with an active work order as a completed cancellation", () => {
    const cancelled = { ...base, insurance_claim_id: "claim-1", claim: {
      id: "claim-1", vehicle_id: vehicle, status: "cancelled", vehicle_presence_status: "in_workshop",
    }, work_order_id: "order-1", work_order: {
      id: "order-1", vehicle_id: vehicle, claim_id: "claim-1", work_order_type: "insurance",
      status: "in_progress", vehicle_presence_status: "in_workshop",
    } };
    expect(resolveVehicleVisit(cancelled, null, false)).toMatchObject({
      stage: "needs_review", reviewReason: "cancelled_with_active_work_order",
    });
  });
  it("uses the database's atomic typed number allocator when creating orders from entries", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/vehicleEntryService.ts"), "utf8");
    const createOrder = source.slice(source.indexOf("export async function createWorkOrderFromVehicleEntry"),
      source.indexOf("export async function convertVehicleEntryToClaim"));
    expect(createOrder).not.toContain("allocateWorkOrderNumber");
    expect(createOrder).toContain('work_order_type: linkedClaimId ? "insurance" : "general_customer"');
    expect(createOrder).toContain('if (getVehicleVisitBillingKind(entry) === "insurance" && !linkedClaimId)');
    expect(createOrder).not.toContain("order_number: orderNumber");
    expect(createOrder).toContain(".or(safeLinkFilter)");
    expect(createOrder).toContain("work_order_id.eq.${savedOrderId}");
    expect(createOrder.slice(createOrder.indexOf("const linkedEntry = await")))
      .not.toContain('.is("work_order_id", null).is("converted_work_order_id", null)');
  });
  it("enforces one active primary work order per vehicle visit at the database layer", () => {
    const migration = readFileSync(join(process.cwd(),
      "supabase/migrations/20261103062836_vehicle_entry_primary_work_order_unique.sql"), "utf8");
    expect(migration).toMatch(/create unique index\s+uq_job_orders_one_primary_vehicle_entry_per_tenant/i);
    expect(migration).toMatch(/on public\.job_orders\s*\(tenant_id, vehicle_entry_id\)/i);
    expect(migration).toMatch(/where vehicle_entry_id is not null\s+and deleted_at is null\s+and parent_work_order_id is null/i);
  });
  it("uses tenant-scoped reads and a cloud-confirmed transition, never browser-local stage state", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/vehicleVisitLifecycle.ts"), "utf8");
    expect(source).toContain('supabase.rpc("advance_vehicle_visit"');
    expect(source).toContain('row.revision !== input.revision + 1');
    expect(source).toContain('.eq("tenant_id", tenantId)');
    expect(source).not.toContain("localStorage");
  });
  it("reads claim/order badges from the same custody and stage resolver as the visit center", () => {
    const service = readFileSync(join(process.cwd(), "src/lib/vehicleVisitLifecycle.ts"), "utf8");
    const badge = readFileSync(join(process.cwd(), "src/components/vehicles/VehicleVisitBadge.tsx"), "utf8");
    const realtime = readFileSync(join(process.cwd(), "src/hooks/useRealtimeSync.ts"), "utf8");
    expect(service).toContain("export async function getLinkedVehicleVisit");
    expect(service).toContain("const visit = resolveVehicleVisit(entry");
    expect(service).toContain("const presence = getVehicleEntryPresence(entry)");
    expect(service).toContain('source === "claim" && !entry.work_order_id && !entry.converted_work_order_id');
    expect(service).toContain('entry.__inferredOrderLink = true');
    expect(badge).toContain("getLinkedVehicleVisit(source, id!)");
    const workOrderDetail = readFileSync(join(process.cwd(), "src/pages/WorkOrderDetail.tsx"), "utf8");
    expect(workOrderDetail).toContain('<VehicleVisitBadge source="work_order" id={order.cloudId || order.id} />');
    const routes = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(routes).toContain('<Route path="/insurance/claims/:id" element={<InsuranceClaimDetail />} />');
    expect(realtime).toContain('insurance_claims: ["insurance_claims", "insurance_invoices", "vehicle_visit"');
    expect(realtime).toContain('job_orders: ["job_orders", "insurance_claims", "vehicle_visit"');
  });
  it("links future claim orders transactionally in both creation orders, without backfilling old visits", () => {
    const migration = readFileSync(join(process.cwd(),
      "supabase/migrations/20261103094500_vehicle_visit_future_claim_order_link.sql"), "utf8");
    expect(migration).toContain("before insert on public.job_orders");
    expect(migration).toContain("after insert on public.job_orders");
    expect(migration).toContain("before insert on public.vehicle_entries");
    expect(migration).toContain("after insert on public.vehicle_entries");
    expect(migration).not.toMatch(/update public\.vehicle_entries\s+set/i);
  });
});
