import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReopenCancelledClaimPatch } from "@/lib/claimReopen";

describe("cancelled insurance claim reopening", () => {
  it("requires a reason", () => {
    expect(() => buildReopenCancelledClaimPatch({ reason: "  ", targetStatus: "pending" }))
      .toThrow("سبب إعادة المطالبة مطلوب");
  });

  it("returns the claim to pending without touching historical documents", () => {
    expect(buildReopenCancelledClaimPatch({
      reason: "وافقت شركة التأمين على المتابعة",
      targetStatus: "pending",
      changedAt: "2026-09-14T08:00:00.000Z",
    })).toEqual({
      status: "pending",
      rejection_reason: null,
      paid_at: null,
      approved_at: null,
      updated_at: "2026-09-14T08:00:00.000Z",
    });
  });

  it("can restore the current approval while resetting cancellation fields", () => {
    expect(buildReopenCancelledClaimPatch({
      reason: "استئناف الإصلاح",
      targetStatus: "approved",
      changedAt: "2026-09-14T09:00:00.000Z",
    })).toMatchObject({
      status: "approved",
      rejection_reason: null,
      paid_at: null,
      approved_at: "2026-09-14T09:00:00.000Z",
    });
  });

  it("exposes the action only for a non-deleted cancelled claim and preserves its history", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/insurance/InsuranceClaimDetail.tsx"), "utf8");
    const dialog = readFileSync(resolve(process.cwd(), "src/components/insurance/ReopenClaimDialog.tsx"), "utf8");

    expect(page).toContain('status === "cancelled" && !(existing as any)?.deleted_at');
    expect(page).toContain('.eq("status", "cancelled")');
    expect(page).toContain('.is("deleted_at", null)');
    expect(page).toContain('writeClaimAudit("claim_reopened"');
    expect(page).toContain("cancellation_document_preserved: true");
    expect(dialog).toContain("إعادة المطالبة لا تحذف تلقائيًا أي مصروف أو فاتورة عميل أو أمر عمل");
  });
});
