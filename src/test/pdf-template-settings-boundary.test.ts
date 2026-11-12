import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), subscribe: vi.fn(),
}));
vi.mock("@/lib/cloudSettings", () => ({
  readCloudSetting: cloud.read, writeCloudSetting: cloud.write, subscribeCloudSetting: cloud.subscribe,
}));
vi.mock("@/lib/printTemplates/resolver", () => ({ renderWithCustomTemplate: vi.fn(() => null) }));
vi.mock("@/lib/safePdfWindow", () => ({ openSanitizedPdfWindow: vi.fn() }));
vi.mock("@/lib/publicAccessSettingsStore", () => ({ buildPublicUrl: (path: string) => path }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  cloud.read.mockResolvedValue(null);
  cloud.write.mockResolvedValue(undefined);
});

describe("lightweight PDF template settings compatibility", () => {
  it("has no rendering dependencies or duplicate cache in the compatibility module", () => {
    const light = readFileSync(resolve(process.cwd(), "src/lib/pdfTemplateSettings.ts"), "utf8");
    const legacy = readFileSync(resolve(process.cwd(), "src/lib/pdfGenerator.ts"), "utf8");
    const imports = Array.from(light.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g), (match) => match[1]);
    expect(imports).toEqual(["./cloudSettings"]);
    expect(light).not.toMatch(/html2canvas|jspdf|safePdfWindow|pdfDocumentRenderer|htmlToPdf/);
    expect(legacy).toContain('export * from "./pdfTemplateSettings"');
    expect(legacy).not.toMatch(/let templateCache|const templateListeners|let templateSettingsLoadedFromCloud/);
  });

  it("preserves public functions, types/default values and a single cloud-backed cache", async () => {
    const settings = await import("@/lib/pdfTemplateSettings");
    const legacy = await import("@/lib/pdfGenerator");
    for (const name of ["getTemplateSettings", "getTemplateSettingsAsync", "loadTemplateSettingsFromCloud", "saveTemplateSettings", "subscribeTemplateSettings"] as const) {
      expect(legacy[name]).toBe(settings[name]);
    }
    expect(legacy.DEFAULT_PDF_TEMPLATE_SETTINGS).toBe(settings.DEFAULT_PDF_TEMPLATE_SETTINGS);
    expect(legacy.STAMP_SIZE_PX).toBe(settings.STAMP_SIZE_PX);
    expect(settings.DEFAULT_PDF_TEMPLATE_SETTINGS).toMatchObject({
      companyName: "شركة الوفاء للأعمال المتكاملة", companyNameEn: "Alwafa Integrated Services",
      vatRate: 5, taxEnabled: true, taxNameEn: "VAT", taxInclusive: false,
      currencyCode: "OMR", decimals: 3, defaultCountryCode: "968",
    });
    const listener = vi.fn();
    const unsubscribe = legacy.subscribeTemplateSettings(listener);
    cloud.read.mockResolvedValue({ companyName: "Cloud brand", logoUrl: "https://example.test/logo.png", vatRate: 7 });
    await settings.loadTemplateSettingsFromCloud();
    expect(legacy.getTemplateSettings()).toBe(settings.getTemplateSettings());
    expect(legacy.getTemplateSettings()).toMatchObject({ companyName: "Cloud brand", logoUrl: "https://example.test/logo.png", vatRate: 7 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await legacy.loadTemplateSettingsFromCloud();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("retains the default-overwrite guard and explicit asset-clearing behavior", async () => {
    const settings = await import("@/lib/pdfTemplateSettings");
    await expect(settings.saveTemplateSettings({ ...settings.DEFAULT_PDF_TEMPLATE_SETTINGS }))
      .rejects.toThrow("company_settings_not_loaded_refusing_default_overwrite");
    expect(cloud.write).not.toHaveBeenCalled();
    cloud.read.mockResolvedValue({ companyName: "Cloud brand", logoUrl: "https://example.test/logo.png" });
    const incoming = { ...settings.DEFAULT_PDF_TEMPLATE_SETTINGS, companyName: "Updated brand" };
    await settings.saveTemplateSettings(incoming);
    expect(settings.getTemplateSettings().logoUrl).toBe("https://example.test/logo.png");
    await settings.saveTemplateSettings(incoming, { clearAssetFields: ["logoUrl"] });
    expect(settings.getTemplateSettings().logoUrl).toBeUndefined();
    expect(cloud.write).toHaveBeenLastCalledWith("company_template_settings_v1", expect.not.objectContaining({ logoUrl: expect.anything() }));
  });
});
