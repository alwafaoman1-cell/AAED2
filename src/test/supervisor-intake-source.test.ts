import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSupervisorIntakeSource } from "@/lib/supervisorIntakeSource";

const mock = vi.hoisted(() => ({ tenant: vi.fn(), from: vi.fn(), rpc: vi.fn(), byClaim: vi.fn(), primary: vi.fn(), write: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mock.tenant }));
vi.mock("@/lib/claimWorkOrderGuard", () => ({ findPrimaryClaimWorkOrder: mock.primary }));
vi.mock("@/lib/vehicleEntryService", async original => ({ ...await original<typeof import("@/lib/vehicleEntryService")>(), getVehicleEntryByClaimId: mock.byClaim }));

const TENANT = "tenant-a";
const CLAIM = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const VEHICLE = "33333333-3333-4333-8333-333333333333";
const ENTRY = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const claim = (extra = {}) => ({ id: CLAIM, tenant_id: TENANT, vehicle_id: VEHICLE, customer_id: "customer", status: "approved", ...extra });
const order = (extra = {}) => ({ id: ORDER, tenant_id: TENANT, vehicle_id: VEHICLE, customer_id: "customer", claim_id: CLAIM, work_order_type: "insurance", status: "in_progress", ...extra });
const linkedEntry = (extra = {}) => ({ id: ENTRY, tenant_id: TENANT, vehicle_id: VEHICLE, insurance_claim_id: CLAIM, work_order_id: ORDER, ...extra });
type Reply = { data: unknown; error: unknown };
type Read = { table: string; eq: Array<[string, unknown]>; is: Array<[string, unknown]>; or?: string; limit?: number };
let replies: Record<string, Reply[]>; let reads: Read[];
function reply(table: string, data: unknown, error: unknown = null) { (replies[table] ||= []).push({ data, error }); }
function identities() {
  reply("vehicles", { id: VEHICLE, tenant_id: TENANT, brand: "Toyota", model: "Prado", plate_number: "1234", plate_letters: "AB", plate_country: "OM" });
  reply("customers", { id: "customer", tenant_id: TENANT, name: "Visit customer", phone: "+96899112233" });
}
beforeEach(() => {
  vi.resetAllMocks(); replies = {}; reads = [];
  mock.tenant.mockResolvedValue(TENANT); mock.byClaim.mockResolvedValue(null); mock.primary.mockResolvedValue(null);
  mock.write.mockImplementation(() => { throw new Error("Intake source must never write/relink"); });
  mock.rpc.mockImplementation(() => { throw new Error("Intake source must never create through RPC"); });
  mock.from.mockImplementation((table: string) => {
    const response = replies[table]?.shift(); if (!response) throw new Error(`Unexpected source read: ${table}`);
    const read: Read = { table, eq: [], is: [] }; reads.push(read);
    const builder: any = {
      select: vi.fn(() => builder), eq: vi.fn((key, value) => { read.eq.push([key, value]); return builder; }),
      is: vi.fn((key, value) => { read.is.push([key, value]); return builder; }),
      or: vi.fn(value => { read.or = value; return builder; }), limit: vi.fn(value => { read.limit = value; return builder; }),
      maybeSingle: vi.fn(async () => response), then: (yes: any, no: any) => Promise.resolve(response).then(yes, no),
      insert: mock.write, update: mock.write, upsert: mock.write, delete: mock.write,
    }; return builder;
  });
});
afterEach(() => {
  expect(mock.write).not.toHaveBeenCalled(); expect(mock.rpc).not.toHaveBeenCalled();
  for (const read of reads) expect(read.eq).toContainEqual(["tenant_id", TENANT]);
});

describe("supervisor intake source read-only identities", () => {
  it.each([{}, { claimId: "not-a-uuid" }, { workOrderId: "WO-002" }, { claimId: CLAIM, workOrderId: "invalid" }])("rejects absent/invalid source IDs before any entity read: %j", async source => {
    await expect(loadSupervisorIntakeSource(source)).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
    expect(mock.from).not.toHaveBeenCalled(); expect(mock.primary).not.toHaveBeenCalled(); expect(mock.byClaim).not.toHaveBeenCalled();
  });
  it("rejects a missing tenant without attempting any entity read", async () => {
    mock.tenant.mockResolvedValue(null);
    await expect(loadSupervisorIntakeSource({ claimId: CLAIM })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID"); expect(mock.from).not.toHaveBeenCalled();
  });
  it.each(["insurance_claims", "job_orders"])("rejects a wrong-tenant %s source even if transport returns one", async table => {
    reply(table, table === "insurance_claims" ? claim({ tenant_id: "tenant-b" }) : order({ tenant_id: "tenant-b" }));
    await expect(loadSupervisorIntakeSource(table === "insurance_claims" ? { claimId: CLAIM } : { workOrderId: ORDER })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
  });
  it.each(["cancelled", "rejected"])("does not admit a %s claim as a new arrival", async status => {
    reply("insurance_claims", claim({ status }));
    await expect(loadSupervisorIntakeSource({ claimId: CLAIM })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID"); expect(mock.primary).not.toHaveBeenCalled();
  });
  it("prefills exact claim identities without inventing an entry or automatically creating a work order", async () => {
    reply("insurance_claims", claim()); identities();
    const result = await loadSupervisorIntakeSource({ claimId: CLAIM });
    expect(result).toMatchObject({ existingEntryId: null, channel: "insurance", form: { insurance_claim_id: CLAIM, work_order_id: null, vehicle_id: VEHICLE, vehicle_location: "داخل الورشة" } });
    expect(result.form?.id).toBeUndefined(); expect(mock.primary).toHaveBeenCalledWith(TENANT, CLAIM); expect(mock.byClaim).toHaveBeenCalledWith(CLAIM);
    expect(reads.some(read => read.table === "job_orders")).toBe(false);
  });
  it("keeps a cash source separate and uses only its explicit order ID", async () => {
    reply("job_orders", order({ claim_id: null, work_order_type: "general_customer" })); reply("vehicle_entries", []); identities();
    const result = await loadSupervisorIntakeSource({ workOrderId: ORDER });
    expect(result).toMatchObject({ channel: "cash", form: { insurance_claim_id: null, work_order_id: ORDER, insurance: { is_insurance_related: false } } });
    expect(mock.primary).not.toHaveBeenCalled(); expect(mock.byClaim).not.toHaveBeenCalled();
  });
  it("rejects conflicting explicit claim/order IDs", async () => {
    reply("job_orders", order({ claim_id: OTHER }));
    await expect(loadSupervisorIntakeSource({ claimId: CLAIM, workOrderId: ORDER })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
  });
  it("rejects an insurance order without its required claim instead of treating it as cash", async () => {
    reply("job_orders", order({ claim_id: null }));
    await expect(loadSupervisorIntakeSource({ workOrderId: ORDER })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
  });
  it("reuses only an existing entry with matching exact claim and order links", async () => {
    reply("job_orders", order({ vehicle_entry_id: ENTRY })); reply("insurance_claims", claim());
    mock.byClaim.mockResolvedValue({ id: ENTRY }); reply("vehicle_entries", [linkedEntry()]); reply("vehicle_entries", linkedEntry());
    await expect(loadSupervisorIntakeSource({ claimId: CLAIM, workOrderId: ORDER })).resolves.toEqual({ existingEntryId: ENTRY, channel: "insurance" });
    expect(reads.find(read => read.or)?.limit).toBe(2);
  });
  it("does not turn a historical order backlink into permission to relink an entry", async () => {
    reply("job_orders", order({ vehicle_entry_id: ENTRY })); reply("insurance_claims", claim()); reply("vehicle_entries", []);
    reply("vehicle_entries", linkedEntry({ insurance_claim_id: null, converted_claim_id: null, work_order_id: null, converted_work_order_id: null }));
    await expect(loadSupervisorIntakeSource({ workOrderId: ORDER })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
  });
  it("rejects two candidate entries instead of picking one or creating a duplicate", async () => {
    reply("job_orders", order()); reply("insurance_claims", claim()); reply("vehicle_entries", [linkedEntry(), linkedEntry({ id: OTHER })]);
    await expect(loadSupervisorIntakeSource({ workOrderId: ORDER })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
  });
  it("rejects an exact-ID candidate attached to a different vehicle", async () => {
    reply("job_orders", order()); reply("insurance_claims", claim()); reply("vehicle_entries", [linkedEntry({ vehicle_id: OTHER })]);
    await expect(loadSupervisorIntakeSource({ workOrderId: ORDER })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
  });
  it("does not create an arrival for a delivered legacy order with no existing entry", async () => {
    reply("job_orders", order({ claim_id: null, work_order_type: "general_customer", status: "delivered" })); reply("vehicle_entries", []);
    await expect(loadSupervisorIntakeSource({ workOrderId: ORDER })).rejects.toThrow("SUPERVISOR_INTAKE_SOURCE_INVALID");
    expect(reads.some(read => read.table === "vehicles")).toBe(false);
  });
  it("propagates a failed lookup rather than treating it as no entry", async () => {
    const error = new Error("read failed"); reply("insurance_claims", null, error);
    await expect(loadSupervisorIntakeSource({ claimId: CLAIM })).rejects.toBe(error);
  });
});
