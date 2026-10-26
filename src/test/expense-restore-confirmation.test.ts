import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  readError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updatePatch: null as Record<string, unknown> | null,
  updateCalls: 0,
  tenantId: "tenant-a",
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({
  getCurrentTenantId: async () => db.tenantId,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "expenses") throw new Error(`Unexpected table: ${table}`);
      const query = (patch?: Record<string, unknown>) => {
        const filters = new Map<string, unknown>();
        const builder = {
          eq(column: string, value: unknown) { filters.set(column, value); return builder; },
          select(_columns: string) { return builder; },
          async maybeSingle() {
            if (patch) {
              db.updateCalls += 1;
              db.updatePatch = patch;
              if (db.updateError) return { data: null, error: db.updateError };
              if (!db.row || filters.get("tenant_id") !== db.row.tenant_id
                || filters.get("id") !== db.row.id
                || filters.get("deleted_at") !== db.row.deleted_at) {
                return { data: null, error: null };
              }
              db.row = { ...db.row, ...patch };
              return { data: db.row, error: null };
            }
            return {
              data: db.row && filters.get("tenant_id") === db.row.tenant_id && filters.get("id") === db.row.id
                ? db.row : null,
              error: db.readError,
            };
          },
        };
        return builder;
      };
      return { select: (_columns: string) => query(), update: (patch: Record<string, unknown>) => query(patch) };
    },
  },
}));

const id = "9f8ee451-e39c-4ee4-97a2-390fa1c82bdf";
const deletedAt = "2026-10-20T10:00:00.000Z";
const record = {
  id,
  voucherNumber: "PAY-2026-0060",
  date: "2026-10-19",
  amount: 25,
  categoryId: "",
  cashboxId: "",
  paymentMethod: "cash" as const,
  createdAt: "2026-10-19T10:00:00.000Z",
};

beforeEach(() => {
  vi.resetModules();
  db.row = {
    id,
    tenant_id: "tenant-a",
    voucher_number: record.voucherNumber,
    date: record.date,
    amount: 25,
    beneficiary: "Original supplier",
    payment_method: "cash",
    meta: { supplierName: "Original supplier", deletedAt, deleteReason: "soft delete" },
    deleted_at: deletedAt,
    created_at: record.createdAt,
  };
  db.readError = null;
  db.updateError = null;
  db.updatePatch = null;
  db.updateCalls = 0;
  db.tenantId = "tenant-a";
});

describe("expense restore confirmation", () => {
  it("restores the existing tenant row without re-inserting or overwriting financial fields", async () => {
    const { expensesStore } = await import("@/lib/expensesStore");
    const restored = await expensesStore.restore(record);
    expect(db.updateCalls).toBe(1);
    expect(Object.keys(db.updatePatch || {}).sort()).toEqual(["deleted_at", "meta"]);
    expect(db.updatePatch).toMatchObject({ deleted_at: null, meta: { supplierName: "Original supplier" } });
    expect(restored).toMatchObject({ id, amount: 25, supplierName: "Original supplier" });
    expect(restored.deletedAt).toBeUndefined();
    expect(expensesStore.getById(id)?.amount).toBe(25);
  });

  it("keeps the client cache unchanged when Supabase rejects the update", async () => {
    db.updateError = { message: "RLS denied" };
    const { expensesStore } = await import("@/lib/expensesStore");
    await expect(expensesStore.restore(record)).rejects.toThrow("RLS denied");
    expect(expensesStore.getById(id)).toBeUndefined();
  });

  it("does not recreate a missing expense row from a stale client copy", async () => {
    db.row = null;
    const { expensesStore } = await import("@/lib/expensesStore");
    await expect(expensesStore.restore(record)).rejects.toThrow("غير موجود في Supabase");
    expect(db.updateCalls).toBe(0);
    expect(expensesStore.getAll()).toEqual([]);
  });

  it("rejects a row owned by a different tenant", async () => {
    db.tenantId = "tenant-b";
    const { expensesStore } = await import("@/lib/expensesStore");
    await expect(expensesStore.restore(record)).rejects.toThrow("غير موجود في Supabase");
    expect(db.updateCalls).toBe(0);
    expect(expensesStore.getAll()).toEqual([]);
  });

  it("publishes a new snapshot when an existing voucher changes in Realtime", async () => {
    const { expensesStore, applyExpenseRealtimeChange } = await import("@/lib/expensesStore");
    const initial = { ...db.row, deleted_at: null, meta: { supplierName: "Original supplier" } };
    await applyExpenseRealtimeChange({ eventType: "INSERT", new: initial });
    const first = expensesStore.getSnapshot();
    expect(first[0].amount).toBe(25);

    await applyExpenseRealtimeChange({ eventType: "UPDATE", new: { ...initial, amount: 35 } });
    expect(expensesStore.getSnapshot()).not.toBe(first);
    expect(expensesStore.getSnapshot()[0].amount).toBe(35);
  });
});
