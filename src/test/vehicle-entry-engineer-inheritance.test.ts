import { beforeEach, describe, expect, it, vi } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TENANT = id(1), ENTRY = id(2), VEHICLE = id(3), CUSTOMER = id(4), COMPANY = id(5), EMPLOYEE = id(6), CLAIM = id(7);
const mock = vi.hoisted(() => ({ entry: null as any, employee: null as any, existing: null as any, inserts: [] as any[], reads: [] as any[] }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: async () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("@/i18n", () => ({ default: { language: "en", t: (key: string) => key, addResourceBundle: vi.fn() } }));
vi.mock("@/lib/i18n/vehicleIntakeWizard", () => ({}));
vi.mock("@/lib/i18n/vehicleEntryLinks", () => ({}));
vi.mock("@/lib/pdfGenerator", () => ({ getTemplateSettings: () => ({}) }));
vi.mock("@/lib/vehicleMediaUrls", () => ({ resolveVehicleMediaUrls: async (rows: any[]) => rows }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from(table: string) {
      let action = "select", payload: any;
      const filters: Record<string, unknown> = {};
      const query: any = {
        select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
        is() { return query; }, order() { return query; }, limit() { return query; },
        insert(value: unknown) { action = "insert"; payload = value; return query; },
        update(value: unknown) { action = "update"; payload = value; return query; },
        maybeSingle: () => execute(true), single: () => execute(true),
        then: (resolve: any, reject: any) => execute(false).then(resolve, reject),
      };
      async function execute(single: boolean) {
        if (action === "insert" && table === "insurance_claims") {
          mock.inserts.push(payload); return { data: { id: "00000000-0000-4000-8000-000000000007", claim_number: "CLAIM-1" }, error: null };
        }
        if (table === "vehicle_entries") return { data: action === "update" ? { id: mock.entry.id } : mock.entry, error: null };
        if (table === "insurance_claims") return { data: mock.existing, error: null };
        if (table === "insurance_company_employees") {
          mock.reads.push(filters);
          const match = mock.employee && Object.entries(filters).every(([key, value]) => mock.employee[key] === value);
          return { data: match ? mock.employee : null, error: null };
        }
        return { data: single ? null : [], error: null };
      }
      return query;
    },
  },
}));

import { convertVehicleEntryToClaim } from "@/lib/vehicleEntryService";

beforeEach(() => {
  mock.entry = { id: ENTRY, tenant_id: TENANT, vehicle_id: VEHICLE, customer_id: CUSTOMER, insurance_company_id: COMPANY,
    insurance_snapshot: { claim_number: "CLAIM-1", employee_id: EMPLOYEE, employee_name: "Selected officer", company_name: "Saved insurer" },
    entry_number: "ENT-1", arrival_date: "2026-11-24", vehicle_location: "داخل الورشة",
    vehicle_snapshot: { make: "Honda", model: "Accord", plate_number: "61905", plate_letters: "M" }, customer_snapshot: { name: "Visit customer" } };
  mock.employee = { id: EMPLOYEE, tenant_id: TENANT, insurance_company_id: COMPANY, is_active: true };
  mock.existing = null; mock.inserts = []; mock.reads = [];
});

describe("persisted intake engineer inheritance on new claim conversion", () => {
  it("copies only the saved contact ID after a same-tenant/company read, without changing the intake snapshot", async () => {
    const before = JSON.stringify(mock.entry);
    expect(await convertVehicleEntryToClaim(ENTRY)).toMatchObject({ existing: false, claim_id: CLAIM });
    expect(mock.reads).toEqual([{ tenant_id: TENANT, id: EMPLOYEE, insurance_company_id: COMPANY }]);
    expect(mock.inserts).toHaveLength(1);
    expect(mock.inserts[0]).toMatchObject({ insurance_employee_id: EMPLOYEE, insurance_company_id: COMPANY, vehicle_entry_id: ENTRY, vehicle_id: VEHICLE, customer_id: CUSTOMER, status: "pending" });
    expect(JSON.stringify(mock.entry)).toBe(before);
  });
  it("does not choose a substitute when the intake has no selected officer", async () => {
    mock.entry.insurance_snapshot.employee_id = "";
    await convertVehicleEntryToClaim(ENTRY);
    expect(mock.reads).toHaveLength(0); expect(mock.inserts[0].insurance_employee_id).toBeNull();
  });
  it.each(["tenant_id", "insurance_company_id"])("rejects a selected contact from another %s before creating any claim", async field => {
    mock.employee[field] = id(90);
    await expect(convertVehicleEntryToClaim(ENTRY)).rejects.toThrow("claim_email_engineer_mismatch");
    expect(mock.inserts).toHaveLength(0);
  });
  it("preserves a historical chosen contact without inventing a new active-contact requirement for creating a claim", async () => {
    mock.employee.is_active = false;
    await convertVehicleEntryToClaim(ENTRY);
    expect(mock.inserts[0].insurance_employee_id).toBe(EMPLOYEE);
  });
  it("does not rewrite an existing linked claim's separately saved officer", async () => {
    mock.entry.insurance_claim_id = CLAIM;
    mock.existing = { id: CLAIM, tenant_id: TENANT, claim_number: "CLAIM-1", vehicle_id: VEHICLE, customer_id: CUSTOMER, vehicle_entry_id: ENTRY, insurance_employee_id: id(88), deleted_at: null };
    expect(await convertVehicleEntryToClaim(ENTRY)).toMatchObject({ existing: true, claim_id: CLAIM });
    expect(mock.inserts).toHaveLength(0); expect(mock.reads).toHaveLength(0); expect(mock.existing.insurance_employee_id).toBe(id(88));
  });
});
