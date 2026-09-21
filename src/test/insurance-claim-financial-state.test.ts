import { describe, expect, it } from "vitest";
import {
  getInsuranceClaimOperationalStatus,
  isInsuranceClaimFinanciallyVoided,
  isInsuranceClaimReceivableEligible,
} from "@/lib/insuranceClaimFinancialState";

describe("insurance claim financial state", () => {
  it("never recognizes cancelled, rejected or deleted claims as receivables", () => {
    expect(isInsuranceClaimReceivableEligible({ status: "cancelled" }, true)).toBe(false);
    expect(isInsuranceClaimReceivableEligible({ status: "rejected" }, true)).toBe(false);
    expect(isInsuranceClaimReceivableEligible({ status: "approved", deleted_at: "2026-09-01" }, true)).toBe(false);
    expect(isInsuranceClaimFinanciallyVoided({ status: "rejected" })).toBe(true);
  });

  it("requires approval, payment state or an active invoice before recognizing a receivable", () => {
    expect(isInsuranceClaimReceivableEligible({ status: "pending" }, false)).toBe(false);
    expect(isInsuranceClaimReceivableEligible({ status: "pending" }, true)).toBe(true);
    expect(isInsuranceClaimReceivableEligible({ status: "approved" }, false)).toBe(true);
    expect(isInsuranceClaimReceivableEligible({ status: "paid" }, false)).toBe(true);
  });

  it("shows the operational status without overriding cancellation or rejection", () => {
    expect(getInsuranceClaimOperationalStatus({ status: "cancelled", delivered_at: "2026-09-01" })).toBe("ملغاة");
    expect(getInsuranceClaimOperationalStatus({ status: "rejected", work_started_at: "2026-09-01" })).toBe("مرفوضة");
    expect(getInsuranceClaimOperationalStatus({ status: "approved", delivered_at: "2026-09-01" })).toBe("تم التسليم");
    expect(getInsuranceClaimOperationalStatus({ status: "approved", work_completed_at: "2026-09-01" })).toBe("مكتملة");
    expect(getInsuranceClaimOperationalStatus({ status: "approved", work_started_at: "2026-09-01" })).toBe("تحت الإصلاح");
    expect(getInsuranceClaimOperationalStatus({ status: "approved" })).toBe("معتمدة");
  });
});
