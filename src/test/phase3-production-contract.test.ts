import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("Phase 3 production contracts", () => {
  it("ships a guarded migration and production smoke runner", () => {
    const migration = fs.readFileSync(
      path.join(root, "supabase/migrations/20260622090000_phase2_cloud_source_whatsapp_constraints.sql"),
      "utf8",
    );
    const smoke = fs.readFileSync(path.join(root, "scripts/production-smoke.mjs"), "utf8");

    expect(migration).toContain("duplicate insurance claim numbers");
    expect(migration).toContain("duplicate job order numbers");
    expect(migration).toContain("duplicate VIN values");
    expect(migration).toContain("CREATE UNIQUE INDEX");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.whatsapp_logs");

    expect(smoke).toContain("Claim → Work Order synchronization failed");
    expect(smoke).toContain("Delivery status did not persist");
    expect(smoke).toContain('rpc("get_public_work_order"');
    expect(smoke).toContain("expectUniqueViolation");
  });
});
