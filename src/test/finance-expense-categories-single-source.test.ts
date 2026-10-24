// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenant: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  removeChannel: vi.fn().mockResolvedValue(undefined),
  channel: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getTenant }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
    auth: { onAuthStateChange: vi.fn() },
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.getTenant.mockReset();
  mocks.eq.mockReset();
  mocks.from.mockReset();
  mocks.channel.mockReset().mockImplementation(() => {
    const subscription = { on: () => subscription, subscribe: () => subscription };
    return subscription;
  });
  mocks.removeChannel.mockClear();
  const query = { select: () => query, eq: mocks.eq };
  mocks.from.mockReturnValue(query);
});

describe("legacy expense category compatibility", () => {
  it("reads the canonical tenant table without inserting or writing a second copy", async () => {
    mocks.getTenant.mockResolvedValue("tenant-1");
    mocks.eq.mockResolvedValue({ data: [{ id: "category-1", name_ar: "قطع غيار", name_en: "Spare Parts", is_active: true }], error: null });
    const { expenseCategoriesStore } = await import("@/lib/financeExpenseCategoriesStore");

    await expenseCategoriesStore.refresh();
    expect(expenseCategoriesStore.getAll()).toEqual([expect.objectContaining({ id: "category-1", name: "قطع غيار", active: true })]);
    expect(mocks.from).toHaveBeenCalledWith("expense_categories");
    expect(mocks.eq).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(() => expenseCategoriesStore.add({ id: "new", name: "غير مؤكد", active: true, createdAt: "" })).toThrow("/accounting/expenses/categories");
  });

  it("discards an older tenant response after the active tenant changes", async () => {
    let currentTenant = "tenant-1";
    mocks.getTenant.mockImplementation(async () => currentTenant);
    let finishFirst!: (value: unknown) => void;
    let finishSecond!: (value: unknown) => void;
    mocks.eq.mockImplementation((_field: string, id: string) => new Promise((resolve) => {
      if (id === "tenant-1") finishFirst = resolve;
      else finishSecond = resolve;
    }));
    const { expenseCategoriesStore } = await import("@/lib/financeExpenseCategoriesStore");

    const first = expenseCategoriesStore.refresh();
    await vi.waitFor(() => expect(mocks.eq).toHaveBeenCalledWith("tenant_id", "tenant-1"));
    currentTenant = "tenant-2";
    const second = expenseCategoriesStore.refresh();
    await vi.waitFor(() => expect(mocks.eq).toHaveBeenCalledWith("tenant_id", "tenant-2"));
    finishSecond({ data: [{ id: "category-2", name_ar: "ميكانيك", is_active: true }], error: null });
    await second;
    finishFirst({ data: [{ id: "category-1", name_ar: "خاطئ", is_active: true }], error: null });
    await first;
    expect(expenseCategoriesStore.getAll().map((row) => row.id)).toEqual(["category-2"]);
  });
});
