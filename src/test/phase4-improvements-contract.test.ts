import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePhone, toE164 } from "@/lib/phoneUtils";
import {
  DEFAULT_SYSTEM_PREFERENCES,
  mergeSystemPreferences,
  hexToHslTriplet,
  SYSTEM_PREFERENCES_KEY,
} from "@/lib/systemPreferences";
import { buildTemplateWorkbook, detectDuplicates, exportRows, normalizePhonesInRows } from "@/lib/importExportCenter";

describe("phase 4 phone and theme preferences", () => {
  it("adds +968 automatically without duplicating the prefix", () => {
    expect(toE164("91234567")).toBe("+96891234567");
    expect(toE164("+96891234567")).toBe("+96891234567");
    expect(normalizePhone("0096891234567")).toBe("96891234567");
  });

  it("uses the changed country prefix from system preferences helpers", () => {
    expect(toE164("501234567", "966")).toBe("+966501234567");
    expect(mergeSystemPreferences({ defaultCountryCode: "+966" }).defaultCountryCode).toBe("966");
    expect(DEFAULT_SYSTEM_PREFERENCES.defaultCountryCode).toBe("968");
    expect(SYSTEM_PREFERENCES_KEY).toBe("system_preferences_v1");
  });

  it("converts tenant theme colors into CSS-ready HSL values", () => {
    const prefs = mergeSystemPreferences({
      activeThemeId: "blue",
      themes: [{ id: "blue", name: "Blue", primary: "#2563eb", accent: "#0ea5e9" }],
    });
    expect(prefs.activeThemeId).toBe("blue");
    expect(hexToHslTriplet(prefs.themes[0].primary)).toMatch(/\d+ \d+% \d+%/);
  });

  it("normalizes imported phone columns with the cloud preference format", async () => {
    const rows = await normalizePhonesInRows([{ phone: "91234567", customer_phone: "+96891234568" }]);
    expect(rows[0].phone).toBe("+96891234567");
    expect(rows[0].customer_phone).toBe("+96891234568");
  });
});

describe("phase 4 import/export contracts", () => {
  it("detects duplicate import rows before saving", () => {
    const duplicates = detectDuplicates("work_orders", [
      { order_number: "WO-2026-0014", phone: "+96891234567", plate: "1234" },
      { order_number: "WO-2026-0014", phone: "96891234567", plate: "1234" },
      { order_number: "WO-2026-0015", phone: "+96899887766", plate: "5678" },
    ]);
    expect(duplicates).toHaveLength(1);
  });

  it("exposes template and export helpers for the import/export center", () => {
    expect(typeof buildTemplateWorkbook).toBe("function");
    expect(typeof exportRows).toBe("function");
  });
});

describe("phase 4 UI and realtime safety contracts", () => {
  const root = process.cwd();
  const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
  const sidebar = readFileSync(resolve(root, "src/components/AppSidebar.tsx"), "utf8");
  const settings = readFileSync(resolve(root, "src/pages/SettingsPage.tsx"), "utf8");
  const workOrderDetail = readFileSync(resolve(root, "src/pages/WorkOrderDetail.tsx"), "utf8");
  const whatsappCenter = readFileSync(resolve(root, "src/components/workorders/WhatsAppCenter.tsx"), "utf8");
  const partsWhatsApp = readFileSync(resolve(root, "src/lib/partsWhatsApp.ts"), "utf8");
  const migration = readFileSync(resolve(root, "supabase/migrations/20260624120000_import_export_operations.sql"), "utf8");
  const countries = readFileSync(resolve(root, "src/lib/countries.ts"), "utf8");

  it("registers the import/export center route and navigation item", () => {
    expect(app).toContain("/import-export");
    expect(sidebar).toContain("/import-export");
  });

  it("adds settings for country prefix and tenant themes without secrets", () => {
    expect(settings).toContain("defaultCountryCode");
    expect(settings).toContain("activeThemeId");
    expect(settings).toContain("systemPreferences");
    expect(settings).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("turns the work order page into a responsive control center", () => {
    expect(workOrderDetail).toContain('data-testid="work-order-control-center"');
    expect(workOrderDetail).toContain("lg:grid-cols");
    expect(workOrderDetail).toContain("PDF / طباعة");
  });

  it("keeps WhatsApp sending through the Edge Function with preview and recipient selection", () => {
    expect(whatsappCenter).toContain("ALL_TEMPLATES");
    expect(whatsappCenter).toContain("normalizedRecipientPhone");
    expect(whatsappCenter).toContain("معاينة قبل الإرسال");
    expect(partsWhatsApp).toContain('supabase.functions.invoke("whatsapp-meta-send"');
  });

  it("adds RLS-protected import/export operation logging and realtime publication", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.import_export_operations");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("supabase_realtime");
  });

  it("does not use LocalStorage as the phone country source", () => {
    expect(countries).not.toContain("localStorage");
  });
});
