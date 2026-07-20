import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("insurance claim media single source contract", () => {
  it("does not write operational media arrays from the active claim detail page", () => {
    const detail = read("src/pages/insurance/InsuranceClaimDetail.tsx");

    expect(detail).toContain("useClaimMedia");
    expect(detail).toContain("uploadClaimMedia.mutateAsync");
    expect(detail).toContain("deleteClaimMedia.mutateAsync");
    expect(detail).not.toMatch(/damage_photos:\s*damagePhotos/);
    expect(detail).not.toMatch(/\bdocuments,\s*\n\s*needed_parts:/);
    expect(detail).not.toMatch(/updates:\s*\{\s*damage_photos/);
    expect(detail).not.toMatch(/updates:\s*\{\s*documents/);
  });

  it("uses vehicle_media as the unified claim media table with legacy backfill", () => {
    const migration = read("supabase/migrations/20260720130000_unify_claim_media_documents.sql");
    const service = read("src/lib/insurance/claimMediaService.ts");

    expect(migration).toContain("alter table public.vehicle_media");
    expect(migration).toContain("insurance_claims.documents");
    expect(migration).toContain("insurance_claims.damage_photos");
    expect(migration).toContain("claim_audit_logs.document_generated");
    expect(migration).toContain("on conflict (tenant_id, storage_bucket, storage_path) do nothing");

    expect(service).toContain('.from("vehicle_media" as any)');
    expect(service).toContain("uploadClaimMedia");
    expect(service).toContain("deleteClaimMedia");
    expect(service).toContain(".remove([storagePath])");
  });
});
