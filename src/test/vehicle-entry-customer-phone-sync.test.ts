import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getTenant: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getTenant }));

import { customerPhoneEdit, defaultVehicleEntryForm, formFromVehicleEntry, saveVehicleEntry } from "@/lib/vehicleEntryService";

function mockQueries(options: { duplicate?: boolean; conflict?: boolean } = {}) {
  const calls: Array<{ table: string; action: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
  mocks.from.mockImplementation((table: string) => {
    const call = { table, action: "read", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
    calls.push(call);
    const result = () => {
      if (table === "vehicle_entries") return { data: { id: "entry-1", entry_number: "ENT-2026-00001" }, error: null };
      if (table === "customers" && call.action === "update") {
        return { data: options.conflict ? null : { id: "customer-1", phone: "+96891234567" }, error: null };
      }
      if (table === "customers") return {
        data: options.duplicate ? [{ id: "customer-2", phone: "+96891234567" }] : [],
        error: null,
      };
      return { data: null, error: null };
    };
    const query: any = {
      select: () => query,
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      ilike: () => query,
      limit: () => query,
      update: (payload: unknown) => { call.action = "update"; call.payload = payload; return query; },
      delete: () => { call.action = "delete"; return query; },
      insert: (payload: unknown) => { call.action = "insert"; call.payload = payload; return query; },
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return query;
  });
  return calls;
}

function editedEntry() {
  const form = defaultVehicleEntryForm();
  form.id = "entry-1";
  form.entry_number = "ENT-2026-00001";
  form.customer_id = "customer-1";
  form.customer_phone_before_edit = "90000000";
  form.customer.phone = "91234567";
  return form;
}

describe("vehicle entry customer phone sync", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.getTenant.mockReset().mockResolvedValue("tenant-1");
  });

  it("loads the live customer phone as the edit baseline, not an old snapshot", () => {
    const form = formFromVehicleEntry({
      id: "entry-1",
      customer_id: "customer-1",
      customer_snapshot: { phone: "90000000" },
      customer: { phone: "+96891111111" },
    });
    expect(form.customer.phone).toBe("+96891111111");
    expect(form.customer_phone_before_edit).toBe("+96891111111");
    expect(customerPhoneEdit(form)).toBeNull();
  });

  it("updates the linked customer only when the phone was edited, scoped to tenant and original phone", async () => {
    const calls = mockQueries();
    await saveVehicleEntry(editedEntry(), "user-1");
    const update = calls.find((call) => call.table === "customers" && call.action === "update");
    expect(update?.payload).toEqual({ phone: "+96891234567" });
    expect(update?.filters).toEqual(expect.arrayContaining([
      ["tenant_id", "tenant-1"], ["id", "customer-1"], ["phone", "90000000"],
    ]));
  });

  it("does not overwrite a customer's phone while saving unrelated entry changes", async () => {
    const calls = mockQueries();
    const form = editedEntry();
    form.customer.phone = "90000000";
    await saveVehicleEntry(form, "user-1");
    expect(calls.some((call) => call.table === "customers" && call.action === "update")).toBe(false);
  });

  it("rejects duplicate numbers and concurrent changes instead of reporting success", async () => {
    mockQueries({ duplicate: true });
    await expect(saveVehicleEntry(editedEntry(), "user-1")).rejects.toMatchObject({
      message: expect.stringContaining("رقم الهاتف مرتبط بعميل آخر"),
      savedEntry: { id: "entry-1" },
    });
    mocks.from.mockReset();
    mockQueries({ conflict: true });
    await expect(saveVehicleEntry(editedEntry(), "user-1")).rejects.toThrow("تغيّر رقم هاتف العميل في جلسة أخرى");
  });
});
