import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyListeners } from "@/lib/notifyListeners";

describe("store subscriber isolation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("notifies remaining subscribers and reports a failed callback", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = vi.fn(() => { throw new Error("render listener failed"); });
    const second = vi.fn();

    notifyListeners(new Set([first, second]), "testStore");

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "[testStore] subscriber failed",
      expect.objectContaining({ message: "render listener failed" }),
    );
  });
});
