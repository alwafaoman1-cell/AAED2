import DOMPurify from "dompurify";
import { buildVehicleTechnicalDeclarationHtml, type VehicleTechnicalDeclarationForm } from "./vehicleTechnicalDeclaration";

function safeHtml(form: VehicleTechnicalDeclarationForm): string {
  return DOMPurify.sanitize(buildVehicleTechnicalDeclarationHtml(form), {
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
    const garageLine = element.closest(".footer-row")?.querySelector("strong")?.textContent === "Garage Name";
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

async function prepareHiddenPage(form: VehicleTechnicalDeclarationForm): Promise<{ iframe: HTMLIFrameElement; page: HTMLElement }> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("PDF frame unavailable");
    doc.open();
    doc.write(safeHtml(form));
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

/** This fixed one-sheet template intentionally bypasses global PDF margin overrides. */
export async function downloadTechnicalDeclarationPdf(form: VehicleTechnicalDeclarationForm, entryNumber: string): Promise<void> {
  const [{ default: html2canvas }, { default: JsPDF }] = await Promise.all([
    import("html2canvas"), import("jspdf"),
  ]);
  const { iframe, page } = await prepareHiddenPage(form);
  try {
    const canvas = await html2canvas(page, { scale: 2, backgroundColor: "#ffffff", logging: false });
    const pdf = new JsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    pdf.setProperties({ title: `Vehicle Technical Declaration ${entryNumber}`, subject: "Vehicle Technical Declaration" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    pdf.save(`Vehicle-Technical-Declaration-${entryNumber.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`);
  } finally {
    iframe.remove();
  }
}
