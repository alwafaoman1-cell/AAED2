import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readClaimEstimateLifecycle } from "@/lib/claimEstimateLifecycle";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

describe("single repair-estimate document lifecycle", () => {
  it("stores one canonical estimate object while retaining timestamped archives for other documents", () => {
    const source = read("src/lib/uploadHtmlAsPdf.ts");

    expect(source).toContain('opts.category === "claim_estimate"');
    expect(source).toContain("current-estimate.pdf");
    expect(source).toContain("upsert: isCanonicalEstimate");
    expect(source).toContain("recordClaimEstimateDocument");
    expect(source).toContain("/${stamp}-${safeName}.pdf`");
  });

  it("hides historical claim-estimate duplicates from the active document picker", () => {
    const source = read("src/hooks/useClaimDocuments.ts");

    expect(source).toContain("let estimateSeen = false");
    expect(source).toContain('document.category !== "claim_estimate"');
    expect(source).toContain("if (estimateSeen) return false");
  });

  it("defines an atomic tenant-bound lifecycle and marks changed sent revisions", () => {
    const sql = read("supabase/migrations/20260924100000_single_claim_estimate_lifecycle.sql");

    expect(sql).toContain("claim_estimate_document_status");
    expect(sql).toContain("record_claim_estimate_document");
    expect(sql).toContain("mark_claim_estimate_sent");
    expect(sql).toContain("for update");
    expect(sql).toContain("tenant_id = public.get_user_tenant_id()");
    expect(sql).toContain("modified_after_send");
    expect(sql).toContain("v_claim.claim_estimate_content_hash is distinct from p_content_hash");
    expect(sql).toContain("not v_changed and v_claim.claim_estimate_document_status = 'sent'");
    expect(sql).toContain("already_sent");
    expect(sql).toContain("revoke all on function public.mark_claim_estimate_dirty_on_claim_change()");
    expect(sql).not.toMatch(/delete\s+from\s+public\.(vehicle_media|insurance_claims)/i);
  });

  it("shows the lifecycle beside the claim status and records explicit email sending", () => {
    const detail = read("src/pages/insurance/InsuranceClaimDetail.tsx");
    const list = read("src/pages/insurance/InsuranceClaimsList.tsx");
    const email = read("src/components/insurance/SendInsuranceEmailDialog.tsx");

    expect(detail).toContain("<ClaimEstimateStatusBadge claim={existing}");
    expect(list).toContain("<ClaimEstimateStatusBadge claim={c} compact");
    expect(detail).toContain("(existing as any)?.claim_estimate_number || computedClaimEstimateNumber");
    expect(detail).toContain('claimEstimateLifecycle.status === "modified_after_send"');
    expect(detail).toContain("await markClaimEstimateSent(id)");
    expect(email).toContain("onEstimateSent?: () => Promise<void>");
    expect(email).toContain("await onEstimateSent()");
    expect(email).toContain("لم يتم تسجيل الإرسال");
  });

  it("normalizes unknown and known database lifecycle values safely", () => {
    expect(readClaimEstimateLifecycle(null).status).toBe("not_created");
    expect(readClaimEstimateLifecycle({ claim_estimate_document_status: "unexpected" }).status).toBe("not_created");
    expect(readClaimEstimateLifecycle({
      claim_estimate_document_status: "modified_after_send",
      claim_estimate_revision: 3,
      claim_estimate_sent_revision: 2,
    })).toMatchObject({ status: "modified_after_send", revision: 3, sentRevision: 2 });
  });
});
