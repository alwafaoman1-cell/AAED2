import DOMPurify from "dompurify";
import { buildVehicleTechnicalDeclarationHtml, TECHNICAL_GARAGE_NAME, type VehicleTechnicalDeclarationForm } from "./vehicleTechnicalDeclaration";

function safeHtml(form: VehicleTechnicalDeclarationForm, language?: "ar" | "en"): string {
  return DOMPurify.sanitize(buildVehicleTechnicalDeclarationHtml(form, language), {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style", "meta"],
    ADD_ATTR: ["dir", "lang"],
  });
}

async function waitForImages(doc: Document): Promise<void> {
  await Promise.all(Array.from(doc.images, async (image) => {
    if (!image.getAttribute("src")) throw new Error("تعذر تحميل توقيع التقرير.");
    if (image.decode) {
      try { await image.decode(); }
      catch { throw new Error("تعذر تحميل توقيع التقرير."); }
      return;
    }
    if (image.complete && image.naturalWidth > 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("تعذر تحميل توقيع التقرير.")), 8000);
      image.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
      image.addEventListener("error", () => { clearTimeout(timer); reject(new Error("تعذر تحميل توقيع التقرير.")); }, { once: true });
    });
  }));
}

function assertSingleA4Page(doc: Document): HTMLElement {
  const page = doc.querySelector<HTMLElement>(".page");
  if (!page) throw new Error("Technical declaration page unavailable");
  for (const element of Array.from(page.querySelectorAll<HTMLElement>(".top > div, .grid .write-line, .footer-row .write-line, .sign-row .write-line"))) {
    const lineHeight = Number.parseFloat(doc.defaultView?.getComputedStyle(element).lineHeight || "") || 18;
    const garageLine = element.classList.contains("garage-name");
    const allowedLines = garageLine ? 2 : 1;
    if (element.scrollHeight > lineHeight * (allowedLines + 0.5)) {
      throw new Error("أحد النصوص أطول من سطره في ورقة A4. اختصر النص ثم أعد المحاولة.");
    }
  }
  if (page.scrollHeight > page.clientHeight + 2 || page.scrollWidth > page.clientWidth + 2) {
    throw new Error("محتوى النموذج يتجاوز صفحة A4. اختصر الملاحظات ثم أعد المحاولة.");
  }
  return page;
}

async function prepareHiddenPage(form: VehicleTechnicalDeclarationForm, language?: "ar" | "en"): Promise<{ iframe: HTMLIFrameElement; page: HTMLElement }> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("PDF frame unavailable");
    doc.open();
    doc.write(safeHtml(form, language));
    doc.close();
    await doc.fonts?.ready;
    await waitForImages(doc);
    return { iframe, page: assertSingleA4Page(doc) };
  } catch (error) {
    iframe.remove();
    throw error;
  }
}

export async function assertPrintableTechnicalDeclaration(form: VehicleTechnicalDeclarationForm): Promise<void> {
  const { iframe } = await prepareHiddenPage(form);
  iframe.remove();
}

export function openTechnicalDeclarationPreview(form: VehicleTechnicalDeclarationForm, target?: Window | null): Window | null {
  const win = target || window.open("", "_blank");
  if (!win) return null;
  try { win.opener = null; } catch { /* Browser may isolate the popup. */ }
  win.document.open();
  win.document.write(safeHtml(form));
  win.document.close();
  try { assertSingleA4Page(win.document); }
  catch (error) { win.close(); throw error; }
  return win;
}

export async function printTechnicalDeclaration(form: VehicleTechnicalDeclarationForm, target?: Window | null): Promise<boolean> {
  const win = openTechnicalDeclarationPreview(form, target);
  if (!win) return false;
  await win.document.fonts?.ready;
  await waitForImages(win.document);
  assertSingleA4Page(win.document);
  win.focus();
  win.print();
  return true;
}

/** The same fixed A4 renderer serves both the saved-form download and email attachment. */
async function renderTechnicalDeclarationPdf(form: VehicleTechnicalDeclarationForm, entryNumber: string, language?: "ar" | "en"): Promise<import("jspdf").jsPDF> {
  const [{ default: html2canvas }, { default: JsPDF }] = await Promise.all([
    import("html2canvas"), import("jspdf"),
  ]);
  const { iframe, page } = await prepareHiddenPage(form, language);
  try {
    const embeddedFontStyle = page.querySelector('style[data-technical-font="embedded"]');
    if (!embeddedFontStyle) throw new Error("Embedded declaration font unavailable");
    // Let the browser shape inline text at the same baseline as preview/print.
    // html2canvas's manual text painter shifts filled values through the ruled
    // underlines in this fixed official form. No export-only position offsets.
    const canvas = await html2canvas(page, {
      scale: 2, backgroundColor: "#ffffff", logging: false, foreignObjectRendering: true,
      onclone: async (clonedDoc, clonedPage) => {
        // copyStyles deliberately drops STYLE nodes in html2canvas 1.4.1.
        // Restore the same self-contained font inside the serialized page.
        clonedPage.prepend(embeddedFontStyle.cloneNode(true));
        const faces = await clonedDoc.fonts.load('700 11pt TemoTechnicalArabic', TECHNICAL_GARAGE_NAME);
        if (!faces.length) throw new Error("Embedded declaration font could not load");
        await clonedDoc.fonts.ready;
      },
    });
    const pdf = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const title = language === "ar" ? "الإقرار الفني للمركبة" : "Vehicle Technical Declaration";
    pdf.setProperties({ title: `${title} ${entryNumber}`, subject: title });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    return pdf;
  } finally {
    iframe.remove();
  }
}

/** Returns a separate attachment without changing the saved declaration or its signature. */
export async function buildTechnicalDeclarationPdfBlob(form: VehicleTechnicalDeclarationForm, entryNumber: string, language?: "ar" | "en"): Promise<Blob> {
  const pdf = await renderTechnicalDeclarationPdf(form, entryNumber, language);
  return pdf.output("blob");
}

/** This fixed one-sheet template intentionally bypasses global PDF margin overrides. */
export async function downloadTechnicalDeclarationPdf(form: VehicleTechnicalDeclarationForm, entryNumber: string): Promise<void> {
  const pdf = await renderTechnicalDeclarationPdf(form, entryNumber);
  pdf.save(`Vehicle-Technical-Declaration-${entryNumber.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`);
}
