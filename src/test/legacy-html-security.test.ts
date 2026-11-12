// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, PDF_HTML_SANDBOX, safePdfImageSrc, sanitizePdfHtml } from "@/lib/safeHtml";

vi.mock("@/lib/printTemplates/resolver", () => ({ renderWithCustomTemplate: vi.fn(() => null) }));
vi.mock("@/lib/safePdfWindow", () => ({ openSanitizedPdfWindow: vi.fn() }));
vi.mock("@/lib/publicAccessSettingsStore", () => ({ buildPublicUrl: (path: string) => `https://example.test${path}` }));
vi.mock("@/lib/cloudSettings", () => ({
  readCloudSetting: vi.fn(async () => null),
  writeCloudSetting: vi.fn(),
  subscribeCloudSetting: vi.fn(),
}));

import {
  DEFAULT_PDF_TEMPLATE_SETTINGS, getInspectionHtml, getInvoiceHtml, getQuoteHtml,
  getTemplateSettings, pdfSignatureStampSectionHtml,
} from "@/lib/pdfGenerator";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const image = "data:image/png;base64,iVBORw0KGgo=";
const invoice = {
  invoiceNumber: "INV-2026-001", date: "2026-11-06", customerName: "Customer",
  customerPhone: "+96890000000", vehicleInfo: "Toyota Camry", plateNumber: "A 1234",
  items: [{ description: "Repair", quantity: 1, unitPrice: 10, total: 10 }],
  subtotal: 10, vat: 0.5, total: 10.5,
};
const inspection = {
  inspectionId: "INS-001", workOrderId: "WO-001", date: "2026-11-06",
  customerName: "Customer", vehicleInfo: "Toyota Camry", damageType: "Bodywork",
  photoCount: 3, status: "مكتمل", notes: "Inspected",
};

beforeEach(() => {
  Object.assign(getTemplateSettings(), DEFAULT_PDF_TEMPLATE_SETTINGS);
});

describe("legacy plain-field escaping (the previous harmless markup probes)", () => {
  it("renders invoice/customer/item/payment fields as literal text, not harmless HTML", () => {
    const probe = '<b data-probe="invoice">literal & "quoted"</b>';
    const doc = parse(getInvoiceHtml({
      ...invoice, invoiceNumber: probe, date: probe, customerName: probe,
      customerPhone: probe, vehicleInfo: probe, plateNumber: probe,
      items: [{ ...invoice.items[0], description: probe }], notes: probe,
      paymentTerms: probe, paidVia: probe, reference: probe,
    }));
    expect(doc.querySelector("[data-probe]")).toBeNull();
    expect(doc.title).toBe(`Invoice ${probe}`);
    expect(doc.body.textContent?.split(probe).length).toBeGreaterThanOrEqual(11);
    expect(doc.querySelector("tbody td:nth-child(2)")?.textContent).toBe(probe);
  });

  it("renders every inspection field, including fallback status, as literal text", () => {
    const probe = '<em data-probe="inspection">literal & text</em>';
    const doc = parse(getInspectionHtml({
      ...inspection, inspectionId: probe, workOrderId: probe, date: probe,
      customerName: probe, vehicleInfo: probe, damageType: probe, status: probe, notes: probe,
    }));
    expect(doc.querySelector("[data-probe]")).toBeNull();
    expect(doc.title).toBe(`Inspection ${probe}`);
    expect(doc.body.textContent?.split(probe).length).toBeGreaterThanOrEqual(10);
  });

  it("uses the same escaping for quotes and shared company/footer/signature text", () => {
    const probe = '<strong data-probe="company">Al Wafa & Co</strong>';
    Object.assign(getTemplateSettings(), {
      companyName: probe, companyNameEn: probe, commercialReg: probe,
      vatNumber: probe, phone: probe, email: probe, address: probe, addressEn: probe,
      footerText: probe, responsibleName: probe, stampEnabled: true,
      signatureUrl: image, stampUrl: image,
    });
    const doc = parse(getQuoteHtml({ ...invoice, quoteNumber: probe, customerName: probe }));
    expect(doc.querySelector("[data-probe]")).toBeNull();
    expect(doc.querySelector("h1")?.textContent).toBe(probe);
    expect(doc.querySelector(".footer")?.textContent).toBe(probe);
    expect(doc.querySelector(".pdf-signature-stamp")?.textContent).toContain(probe);
    expect(doc.querySelectorAll(".pdf-signature-stamp img")).toHaveLength(2);
  });

  it("escapes all five HTML delimiters exactly once", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(0)).toBe("0");
    expect(parse(`<p>${escapeHtml("&lt;b&gt;")}</p>`).querySelector("p")?.textContent).toBe("&lt;b&gt;");
  });

  it("does not let a stored CSS color break out of style or append declarations", () => {
    getTemplateSettings().primaryColor = '</style><b data-color-probe>injected</b><style>';
    const doc = parse(getInvoiceHtml(invoice));
    expect(doc.querySelector("[data-color-probe]")).toBeNull();
    expect(doc.querySelector("style")?.textContent).toContain("#d4a537");
  });

  it("keeps script/event/URL-shaped field values as visible text before final sanitization", () => {
    const payload = '<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)">';
    for (const html of [
      getInvoiceHtml({ ...invoice, customerName: payload, notes: payload, items: [{ ...invoice.items[0], description: payload }] }),
      getInspectionHtml({ ...inspection, damageType: payload, notes: payload }),
    ]) {
      const doc = parse(html);
      expect(doc.querySelector("script,[onerror]")).toBeNull();
      expect(doc.body.textContent).toContain(payload);
    }
  });
});

describe("central final HTML boundary", () => {
  it("removes scripts, handlers, active embeds, forms, base and meta refresh", () => {
    const doc = parse(sanitizePdfHtml(`<!doctype html><html><head>
      <base href="https://attacker.test/"><meta http-equiv="refresh" content="0;url=https://attacker.test/">
      <meta http-equiv="Content-Security-Policy" content="script-src * 'unsafe-inline'">
      </head><body onload="alert(1)"><script>alert(1)</script>
      <img src="${image}" onerror="alert(1)"><svg onload="alert(1)"><path d="M0 0h1v1z"/></svg>
      <iframe srcdoc="<script>alert(1)</script>"></iframe><object data="data:text/html,bad"></object>
      <embed src="data:text/html,bad"><form action="https://attacker.test"><input name="secret"></form>
      <div onclick="alert(1)">Safe content</div></body></html>`));
    expect(doc.querySelector("script,iframe,object,embed,form,input,base")).toBeNull();
    expect(doc.querySelector("[onload],[onerror],[onclick],[srcdoc]")).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    const policies = doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    expect(policies).toHaveLength(1);
    expect(policies[0].getAttribute("content")).toContain("script-src 'none'");
    expect(doc.body.textContent).toContain("Safe content");
  });

  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)",
    "vbscript:msgbox(1)", "data:text/html,<script>alert(1)</script>", "file:///C:/secret",
  ])("rejects executable/non-document URLs: %s", (url) => {
    const doc = parse(sanitizePdfHtml(`<a href="${escapeHtml(url)}">link</a><img src="${escapeHtml(url)}">`));
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(doc.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(safePdfImageSrc(url)).toBe("");
  });

  it("rejects entity-obfuscated URL schemes and SVG URL handlers", () => {
    const doc = parse(sanitizePdfHtml('<a href="jav&#x61;script:alert(1)">bad</a><svg><a xlink:href="javascript:alert(1)"><text>bad</text></a></svg>'));
    expect(doc.querySelector("[href],[xlink\\:href]")).toBeNull();
  });

  it("keeps safe responsive image candidates without keeping active URL candidates", () => {
    const doc = parse(sanitizePdfHtml('<img id="safe" src="/logo.png" srcset="/logo.png 1x, /logo@2x.png 2x"><img id="bad" src="/logo.png" srcset="/logo.png 1x, javascript:alert(1) 2x">'));
    expect(doc.querySelector("#safe")?.getAttribute("srcset")).toBe("/logo.png 1x, /logo@2x.png 2x");
    expect(doc.querySelector("#bad")?.hasAttribute("srcset")).toBe(false);
  });

  it("attribute-escapes valid image URLs instead of creating new event attributes", () => {
    const url = 'https://example.test/logo.png?name=" onerror="alert(1)&x=1';
    const doc = parse(`<img src="${safePdfImageSrc(url)}">`);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(doc.querySelector("[onerror]")).toBeNull();
    const signature = parse(pdfSignatureStampSectionHtml({ signatureUrl: "javascript:alert(1)", stampUrl: image }));
    expect(signature.querySelector('img[alt="signature"]')?.getAttribute("src")).toBe("");
    expect(signature.querySelector('img[alt="Company Stamp"]')?.getAttribute("src")).toBe(image);
  });

  it("preserves RTL/A4 CSS, font links, table pagination hooks, signature/QR/image formats", () => {
    const css = '@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic"); @page{size:A4;margin:12mm} .page{break-after:page} thead{display:table-header-group}';
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>${css}</style></head>
      <body><main class="page pdf-keep" data-pdf-paginated="1" style="padding:12mm;direction:rtl">
      <h1>الوفاء &amp; Al Wafa</h1><table><thead><tr><th>Item</th></tr></thead><tbody><tr><td>Repair</td></tr></tbody></table>
      <section class="pdf-signature-stamp no-break"><img alt="signature" src="${image}">
      <img alt="stamp" src="https://example.test/stamp.png?token=a&amp;b=c">
      <img alt="QR" src="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E">
      <img alt="blob" src="blob:https://example.test/image-id">
      <img alt="relative" src="/assets/logo.png"></section><svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>
      <a href="https://example.test/p/token" target="_blank">Tracking</a></main><main class="page">Next page</main></body></html>`;
    const doc = parse(sanitizePdfHtml(html));
    expect(doc.documentElement.lang).toBe("ar");
    expect(doc.documentElement.dir).toBe("rtl");
    expect(doc.querySelector("style")?.textContent).toBe(css);
    expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute("href")).toContain("fonts.googleapis.com");
    expect(doc.querySelectorAll(".page")).toHaveLength(2);
    expect(doc.querySelector(".page")?.getAttribute("data-pdf-paginated")).toBe("1");
    expect(doc.querySelector(".page")?.getAttribute("style")).toContain("padding:12mm");
    expect(doc.querySelector("thead th")?.textContent).toBe("Item");
    expect(doc.querySelectorAll(".pdf-signature-stamp img[src]")).toHaveLength(5);
    expect(doc.querySelector("svg path")?.getAttribute("d")).toBe("M0 0h10v10z");
    expect(doc.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
    const twice = parse(sanitizePdfHtml(sanitizePdfHtml(html)));
    expect(twice.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).toHaveLength(1);
    expect(twice.querySelectorAll(".page")).toHaveLength(2);
    expect(twice.querySelectorAll("img[src]")).toHaveLength(5);
    expect(twice.body.textContent).toBe(doc.body.textContent);
  });

  it("keeps English documents English without introducing Arabic labels", () => {
    const doc = parse(sanitizePdfHtml('<html lang="en" dir="ltr"><head><title>Invoice</title></head><body><main class="page">Customer invoice</main></body></html>'));
    expect(doc.documentElement.lang).toBe("en");
    expect(doc.documentElement.dir).toBe("ltr");
    expect(doc.body.textContent).toBe("Customer invoice");
  });

  it("retains parent DOM/print permissions without enabling document scripts or navigation", () => {
    expect(PDF_HTML_SANDBOX.split(" ")).toEqual(["allow-same-origin", "allow-modals"]);
    expect(PDF_HTML_SANDBOX).not.toMatch(/allow-scripts|allow-popups|allow-top-navigation|allow-forms/);
  });
});
