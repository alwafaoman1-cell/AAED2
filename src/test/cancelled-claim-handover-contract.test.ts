import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCancelledClaimVehicleHandoverHtml } from "@/lib/cancelledClaimVehicleHandover";

describe("cancelled claim vehicle handover evidence", () => {
  it("prints the receiver identity, reservations, contents and removed-parts acknowledgement", () => {
    const html = buildCancelledClaimVehicleHandoverHtml({
      claimNumber: "C/2026/001",
      receiverName: "محمد علي",
      receiverIdNumber: "OM-12345",
      receiverNotes: "خدش خلفي مثبت",
      receiverSignatureDataUrl: "data:image/png;base64,c2lnbmF0dXJl",
      handoverAt: "2026-09-14T10:00:00.000Z",
    }, {
      companyName: "شركة الوفاء للأعمال المتكاملة ش م م",
      companyNameEn: "Al Wafa Integrated Business Company LLC",
    } as any);

    expect(html).toContain("محمد علي");
    expect(html).toContain("OM-12345");
    expect(html).toContain("خدش خلفي مثبت");
    expect(html).toContain("كافة القطع القديمة أو المفكوكة والمتاحة");
    expect(html).toContain("تنتهي حيازة الورشة");
    expect(html).toContain("لا يجوز قانونًا التنازل عنها");
    expect(html).toContain("data:image/png;base64,c2lnbmF0dXJl");
  });

  it("requires acknowledgement and persists receiver data before opening the archived PDF", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/insurance/InsuranceClaimDetail.tsx"), "utf8");

    expect(page).toContain("handlePrepareCancelledClaimHandover");
    expect(page).toContain("cancelledHandoverAcknowledged");
    expect(page).toContain("cancelledHandoverSignature");
    expect(page).toContain("data:image/png;base64,");
    expect(page).toContain("اسم المستلم مطلوب قبل إصدار ورقة التسليم");
    expect(page).toContain("رقم هوية أو جواز المستلم مطلوب");
    expect(page).toContain("receiver_name: receiverName");
    expect(page).toContain("receiver_id_number: receiverIdNumber");
    expect(page).toContain("cancelled_handover_signature_data_url: cancelledHandoverSignature");
    expect(page).toContain("cancelled_handover_signed_at");
    expect(page).toContain('.eq("status", "cancelled")');
    expect(page).toContain('writeClaimAudit("cancelled_claim_handover_prepared"');
    expect(page.indexOf("receiver_name: receiverName")).toBeLessThan(page.indexOf("setShowCancelledHandover(true)"));
  });

  it("stores the signature in the claim with a database timestamp and bounded PNG format", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260914120000_cancelled_claim_handover_signature.sql"), "utf8");

    expect(migration).toContain("cancelled_handover_signature_data_url");
    expect(migration).toContain("cancelled_handover_signed_at");
    expect(migration).toContain("data:image/png;base64,%");
    expect(migration).toContain("char_length(cancelled_handover_signature_data_url) <= 500000");
    expect(migration).toContain("new.cancelled_handover_signed_at := now()");
    expect(migration).toContain("old.cancelled_handover_signed_at");
  });
});
