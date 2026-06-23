import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { featureForPath } from "@/contexts/FeatureContext";

describe("SaaS feature routing", () => {
  it("maps sensitive modules to tenant feature keys", () => {
    expect(featureForPath("/insurance/claims")).toBe("insurance");
    expect(featureForPath("/insurance/accounting")).toBe("insurance_accounting");
    expect(featureForPath("/work-orders/WO-2026-0014")).toBe("workshop");
    expect(featureForPath("/messages")).toBe("whatsapp");
  });
});

describe("SaaS security contract", () => {
  const root = process.cwd();
  const migration = readFileSync(
    resolve(root, "supabase/migrations/20260623130000_saas_admin_console.sql"),
    "utf8",
  );
  const whatsappFunction = readFileSync(
    resolve(root, "supabase/functions/whatsapp-meta-send/index.ts"),
    "utf8",
  );
  const domainFunction = readFileSync(
    resolve(root, "supabase/functions/manage-tenant-domain/index.ts"),
    "utf8",
  );
  const inspectionsStore = readFileSync(resolve(root, "src/lib/inspectionsStore.ts"), "utf8");
  const aiExtractFunction = readFileSync(resolve(root, "supabase/functions/ai-extract-data/index.ts"), "utf8");

  it("keeps tenant files private and tenant scoped", () => {
    expect(migration).toContain("VALUES ('tenant-files', 'tenant-files', false");
    expect(migration).toContain("(storage.foldername(name))[1] = public.get_user_tenant_id()::text");
    expect(migration).toContain("ALTER TABLE public.tenant_files ENABLE ROW LEVEL SECURITY");
  });

  it("resolves only active domains for active tenants", () => {
    expect(migration).toContain("d.status = 'active'");
    expect(migration).toContain("t.is_active = true");
    expect(domainFunction).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(domainFunction).toContain("VERCEL_API_TOKEN");
  });

  it("enforces WhatsApp feature status on the server and requires secure links", () => {
    expect(whatsappFunction).toContain('feature_key", "whatsapp"');
    expect(whatsappFunction).toContain("feature_disabled");
    expect(whatsappFunction).toContain("secure_https_link_required");
  });

  it("keeps inspections cloud-first without demo or local storage data", () => {
    expect(inspectionsStore).toContain('supabase.from("inspections")');
    expect(inspectionsStore).not.toContain("localStorage");
    expect(inspectionsStore).not.toContain("INS-001");
  });

  it("limits diagnostic AI output to codes, problems and severity", () => {
    expect(aiExtractFunction).toContain("diagnostic_report");
    expect(aiExtractFunction).toContain("Do not provide repair instructions");
    expect(aiExtractFunction).toContain("AI feature is disabled for this workshop");
  });
});
