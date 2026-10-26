// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: mocks.eq }) }),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

import { useUpdateInsuranceEstimate } from "@/hooks/useInsuranceEstimates";

describe("insurance estimate update failure", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("rejects a failed cloud update and displays the error", async () => {
    mocks.eq.mockResolvedValue({ error: new Error("تعذر حفظ التقدير في السحابة") });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateInsuranceEstimate(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: "estimate-1", patch: { notes: "updated" } }))
        .rejects.toThrow("تعذر حفظ التقدير في السحابة");
    });

    expect(mocks.toastError).toHaveBeenCalledWith("تعذر حفظ التقدير في السحابة");
  });
});
