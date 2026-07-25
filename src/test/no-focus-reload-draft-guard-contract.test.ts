import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

describe("no focus reload and draft loss guard contract", () => {
  it("keeps tab focus and reconnect from triggering React Query refetch storms", () => {
    const app = read("src/App.tsx");

    expect(app).toContain("refetchOnWindowFocus: false");
    expect(app).toContain("refetchOnReconnect: false");
    expect(app).toContain("focusManager.setEventListener(() => () => {})");
    expect(app).toContain("UnsavedWorkGuard");
  });

  it("blocks PWA/chunk update reload while unsaved work exists", () => {
    const chunkRecovery = read("src/lib/chunkRecovery.ts");
    const updateNotice = read("src/components/UpdateNotice.tsx");
    const registerPwa = read("src/lib/registerPwa.ts");

    expect(chunkRecovery).toContain("hasUnsavedWork");
    expect(chunkRecovery).toContain("blocked_dirty_form");
    expect(chunkRecovery).toContain("isChunkLoadError");
    expect(registerPwa).toContain("Do not call updateSW(true)");
    expect(updateNotice).toContain("hasUnsavedWork");
    expect(updateNotice).toContain("if (dirty)");
    expect(updateNotice).not.toContain("if (!force && dirty)");
    expect(updateNotice).not.toContain("if (dirty && !latest?.mandatory)");
  });

  it("registers beforeunload only through the central dirty registry", () => {
    const unsavedWork = read("src/lib/unsavedWork.ts");
    const workOrdersStore = read("src/lib/workOrdersStore.ts");
    const claimDetail = read("src/pages/insurance/InsuranceClaimDetail.tsx");

    expect(unsavedWork).toContain("subscribeUnsavedWork");
    expect(unsavedWork).toContain("window.addEventListener(\"beforeunload\", handleBeforeUnload)");
    expect(unsavedWork).toContain("window.removeEventListener(\"beforeunload\", handleBeforeUnload)");
    expect(workOrdersStore).toContain("ensurePendingPatchUnloadFlush");
    expect(workOrdersStore).not.toContain("window.addEventListener(\"beforeunload\", () =>");
    expect(claimDetail).toContain("markDirty(scope)");
    expect(claimDetail).not.toContain("addEventListener(\"beforeunload\"");
    expect(claimDetail).not.toContain("window.location.reload()");
  });

  it("persists only sanitized UI drafts for the critical creation forms", () => {
    const draftService = read("src/lib/drafts/draftService.ts");
    const workOrderForm = read("src/components/workorders/WorkOrderForm.tsx");
    const estimateForm = read("src/pages/estimates/EstimateForm.tsx");
    const newClaim = read("src/pages/insurance/NewInsuranceClaim.tsx");

    expect(draftService).toContain("window.sessionStorage");
    expect(draftService).toContain("value instanceof File");
    expect(draftService).toContain("value instanceof Blob");
    expect(draftService).toContain("sk_live_");
    expect(workOrderForm).toContain("useDraftPersistence");
    expect(estimateForm).toContain("useDraftPersistence");
    expect(newClaim).toContain("markDirty");
    expect(newClaim).toContain("markClean");
  });

  it("batches realtime reloads in MessagesCenter instead of firing one load per event", () => {
    const messages = read("src/pages/MessagesCenter.tsx");

    expect(messages).toContain("scheduleLoad");
    expect(messages).toContain("window.setTimeout");
    expect(messages).not.toContain("customer_notifications\" }, () => load())");
    expect(messages).not.toContain("message_logs\" }, () => load())");
  });

  it("does not invalidate realtime queries immediately on tab focus return", () => {
    const realtime = read("src/hooks/useRealtimeSync.ts");

    expect(realtime).toContain("handleVisibilityChange");
    expect(realtime).toContain("pending.clear()");
    expect(realtime).toContain("isRecentlyReturnedToTab()");
    expect(realtime).toContain("document.visibilityState !== \"visible\"");
  });
});
