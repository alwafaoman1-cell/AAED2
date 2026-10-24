// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureProvider, useFeatures } from "@/contexts/FeatureContext";

const mocks = vi.hoisted(() => ({
  tenantId: "tenant-a" as string | null,
  listTenantFeatures: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: mocks.tenantId ? { tenant_id: mocks.tenantId } : null }),
}));

vi.mock("@/lib/saasAdmin", () => ({
  FEATURE_DEFINITIONS: [["whatsapp", "WhatsApp", "واتساب"], ["reports", "Reports", "التقارير"]],
  listTenantFeatures: mocks.listTenantFeatures,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: mocks.removeChannel,
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => <FeatureProvider>{children}</FeatureProvider>;

beforeEach(() => {
  mocks.tenantId = "tenant-a";
  mocks.listTenantFeatures.mockReset();
  mocks.removeChannel.mockReset();
});

describe("feature settings tenant isolation", () => {
  it("ignores a late response from the previous tenant", async () => {
    let resolveA!: (rows: unknown[]) => void;
    let resolveB!: (rows: unknown[]) => void;
    mocks.listTenantFeatures.mockImplementation((tenantId: string) => new Promise((resolve) => {
      if (tenantId === "tenant-a") resolveA = resolve;
      else resolveB = resolve;
    }));
    const { result, rerender } = renderHook(() => useFeatures(), { wrapper });
    expect(result.current.loading).toBe(true);

    act(() => { mocks.tenantId = "tenant-b"; rerender(); });
    expect(result.current.loading).toBe(true);
    act(() => resolveA([{ feature_key: "whatsapp", enabled: false, settings: { secret: "tenant-a" } }]));
    expect(result.current.settings.whatsapp).toBeUndefined();

    act(() => resolveB([{ feature_key: "whatsapp", enabled: false, settings: { owner: "tenant-b" } }]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled.whatsapp).toBe(false);
    expect(result.current.settings.whatsapp).toEqual({ owner: "tenant-b" });
    expect(mocks.removeChannel).toHaveBeenCalled();
  });

  it("clears a tenant's settings when the profile is removed", async () => {
    mocks.listTenantFeatures.mockResolvedValue([
      { feature_key: "whatsapp", enabled: false, settings: { owner: "tenant-a" } },
    ]);
    const { result, rerender } = renderHook(() => useFeatures(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.whatsapp).toEqual({ owner: "tenant-a" });

    act(() => { mocks.tenantId = null; rerender(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.whatsapp).toBeUndefined();
  });
});
