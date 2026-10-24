// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenant: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/cloud/createCloudStore", () => ({ getCurrentTenantId: mocks.getTenant }));
vi.mock("@/lib/cloudSettings", () => ({
  readCloudSetting: vi.fn().mockResolvedValue({}),
  writeCloudSetting: mocks.write,
  subscribeCloudSetting: vi.fn().mockReturnValue(() => undefined),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) } },
}));
vi.mock("@/lib/createStore", () => ({
  createStore: () => ({
    getAll: () => [],
    getById: () => undefined,
    subscribe: () => () => undefined,
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.getTenant.mockReset().mockResolvedValue("tenant-1");
  mocks.write.mockReset();
});

describe("voucher settings confirmed save", () => {
  it("does not report success or alter the active settings when cloud write fails", async () => {
    const { voucherSettingsStore } = await import("@/lib/financeSettingsStore");
    const original = voucherSettingsStore.get().receiptPrefix;
    mocks.write.mockRejectedValue(new Error("RLS denied"));
    await expect(voucherSettingsStore.updateConfirmed({ receiptPrefix: "TEST" })).rejects.toThrow("RLS denied");
    expect(voucherSettingsStore.get().receiptPrefix).toBe(original);
  });

  it("updates the active settings only after cloud confirmation", async () => {
    const { voucherSettingsStore } = await import("@/lib/financeSettingsStore");
    let resolveWrite!: () => void;
    mocks.write.mockImplementation(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const saving = voucherSettingsStore.updateConfirmed({ receiptPrefix: "TEST" });
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled());
    expect(voucherSettingsStore.get().receiptPrefix).not.toBe("TEST");
    resolveWrite();
    await saving;
    expect(voucherSettingsStore.get().receiptPrefix).toBe("TEST");
  });
});
