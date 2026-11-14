import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ tenant: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mock.tenant }));
import { getReviewVisitIntakeSignatureState } from "@/lib/vehicleReviewVisit";
beforeEach(() => { vi.clearAllMocks(); mock.tenant.mockResolvedValue("tenant"); });
function rows(signatures: Record<string, unknown>[], revision: unknown = 2) {
  const queries: { table: string; filters: Record<string, unknown> }[] = [];
  mock.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    queries.push({ table, filters });
    const chain: Record<string, any> = {};
    for (const method of ["select", "limit", "is"]) chain[method] = () => chain;
    chain.eq = (key: string, value: unknown) => { filters[key] = value; return chain; };
    chain.maybeSingle = async () => ({ error: null, data: table === "vehicle_entries" ? { intake_revision: revision } : signatures.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) || null });
    return chain;
  });
  return queries;
}
it("does not authorize review from another tenant, a previous revision or the employee receiver signature", async () => {
  const queries = rows([
    { id: "old", tenant_id: "tenant", vehicle_entry_id: "review", signature_role: "delivered_by", intake_revision: 1 },
    { id: "receiver", tenant_id: "tenant", vehicle_entry_id: "review", signature_role: "receiver", intake_revision: 2 },
    { id: "other-tenant", tenant_id: "other", vehicle_entry_id: "review", signature_role: "delivered_by", intake_revision: 2 },
  ]);
  expect(await getReviewVisitIntakeSignatureState("review")).toEqual({ revision: 2, signed: false });
  expect(queries[1].filters).toEqual({ tenant_id: "tenant", vehicle_entry_id: "review", signature_role: "delivered_by", intake_revision: 2 });
});
it("recognizes only the current customer's canonical delivered_by signature", async () => {
  rows([{ id: "current", tenant_id: "tenant", vehicle_entry_id: "review", signature_role: "delivered_by", intake_revision: 2 }]);
  expect(await getReviewVisitIntakeSignatureState("review")).toEqual({ revision: 2, signed: true });
});
it.each([null, -1, 0])("fails closed when the current intake revision is unavailable (%j)", async revision => {
  rows([], revision);
  expect(await getReviewVisitIntakeSignatureState("review")).toBeNull();
  expect(mock.from).toHaveBeenCalledTimes(1);
});
it("does not query records without an active tenant", async () => {
  mock.tenant.mockResolvedValue(null);
  expect(await getReviewVisitIntakeSignatureState("review")).toBeNull();
  expect(mock.from).not.toHaveBeenCalled();
});
