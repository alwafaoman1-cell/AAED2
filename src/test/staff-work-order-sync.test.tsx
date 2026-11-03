// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStaffWorkOrderSync } from "@/hooks/useStaffWorkOrderSync";
import { markClean, markDirty } from "@/lib/unsavedWork";

const cloud = vi.hoisted(() => ({ refresh: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1" } }) }));
vi.mock("@/lib/workOrdersStore", () => ({ refreshWorkOrdersFromCloud: cloud.refresh }));

function StaffReader() { useStaffWorkOrderSync(); return null; }

describe("staff work-order reconciliation", () => {
  let visible: "visible" | "hidden";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T08:00:00Z"));
    visible = "visible";
    cloud.refresh.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible });
  });

  afterEach(() => {
    cleanup();
    markClean("staff-test-draft");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads on entry and reconciles missed events only after a long background interval", async () => {
    await act(async () => { render(<StaffReader />); });
    expect(cloud.refresh).toHaveBeenCalledTimes(1);
    act(() => { visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
    act(() => { vi.advanceTimersByTime(10_000); visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    expect(cloud.refresh).toHaveBeenCalledTimes(1);
    act(() => { visible = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { vi.advanceTimersByTime(31_000); visible = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
    expect(cloud.refresh).toHaveBeenCalledTimes(2);
  });

  it("reconciles after reconnect but never overwrites an unsaved staff edit", async () => {
    await act(async () => { render(<StaffReader />); });
    act(() => { markDirty("staff-test-draft"); window.dispatchEvent(new Event("online")); });
    expect(cloud.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { markClean("staff-test-draft"); });
    expect(cloud.refresh).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(cloud.refresh).toHaveBeenCalledTimes(3);
  });
});
