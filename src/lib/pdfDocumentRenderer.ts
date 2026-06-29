export type PdfOrientation = "portrait" | "landscape";

export const A4_PIXELS = {
  portrait: { width: 794, height: 1123 },
  landscape: { width: 1123, height: 794 },
} as const;

const PAGED_ATTR = "data-pdf-paginated";
const PAGE_GAP_PX = 24;

export async function waitForPdfAssets(doc: Document, timeoutMs = 5000): Promise<void> {
  const fontReady = (async () => {
    try { await (doc as any).fonts?.ready; } catch { /* optional browser API */ }
  })();
  const imageReady = Promise.all(
    Array.from(doc.images || []).map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  ).then(() => undefined);

  await Promise.race([
    Promise.all([fontReady, imageReady]).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function createEmptyPage(source: HTMLElement, orientation: PdfOrientation): HTMLElement {
  const page = source.cloneNode(false) as HTMLElement;
  const { width, height } = A4_PIXELS[orientation];
  page.removeAttribute(PAGED_ATTR);
  page.style.width = `${width}px`;
  page.style.height = `${height}px`;
  page.style.minHeight = `${height}px`;
  page.style.maxHeight = "none";
  page.style.overflow = "visible";
  page.style.margin = `0 auto ${PAGE_GAP_PX}px`;
  page.style.boxSizing = "border-box";
  page.style.position = "relative";
  return page;
}

function pageOverflows(page: HTMLElement): boolean {
  return page.scrollHeight > page.clientHeight + 2 || page.scrollWidth > page.clientWidth + 2;
}

function splitTableBlock(
  block: HTMLElement,
  currentPage: HTMLElement,
  newPage: () => HTMLElement,
): boolean {
  const sourceTable = (block.matches("table") ? block : block.querySelector("table")) as HTMLTableElement | null;
  const sourceBody = sourceTable?.tBodies?.[0];
  if (!sourceTable || !sourceBody || sourceBody.rows.length < 2) return false;

  const makeBlock = () => {
    const clone = block.cloneNode(true) as HTMLElement;
    const table = clone.matches("table") ? clone as HTMLTableElement : clone.querySelector("table");
    const body = table?.tBodies?.[0];
    if (!body) return null;
    body.replaceChildren();
    return { clone, body };
  };

  let targetPage = currentPage;
  let target = makeBlock();
  if (!target) return false;
  targetPage.appendChild(target.clone);

  for (const row of Array.from(sourceBody.rows) as HTMLTableRowElement[]) {
    target.body.appendChild(row.cloneNode(true));
    if (!pageOverflows(targetPage)) continue;

    target.body.lastElementChild?.remove();
    if (target.body.rows.length === 0) {
      target.clone.remove();
      return false;
    }

    targetPage = newPage();
    target = makeBlock();
    if (!target) return false;
    targetPage.appendChild(target.clone);
    target.body.appendChild(row.cloneNode(true));
    if (pageOverflows(targetPage)) targetPage.dataset.pdfOversized = "true";
  }
  return true;
}

function splitChildContainer(
  block: HTMLElement,
  currentPage: HTMLElement,
  newPage: () => HTMLElement,
): boolean {
  const sourceChildren = Array.from(block.children);
  if (sourceChildren.length < 2) return false;

  const makeBlock = () => {
    const clone = block.cloneNode(false) as HTMLElement;
    return clone;
  };

  let targetPage = currentPage;
  let target = makeBlock();
  targetPage.appendChild(target);

  for (const child of sourceChildren as Element[]) {
    target.appendChild(child.cloneNode(true));
    if (!pageOverflows(targetPage)) continue;

    target.lastElementChild?.remove();
    if (!target.children.length) {
      target.remove();
      return false;
    }

    targetPage = newPage();
    target = makeBlock();
    targetPage.appendChild(target);
    target.appendChild(child.cloneNode(true));
    if (pageOverflows(targetPage)) targetPage.dataset.pdfOversized = "true";
  }
  return true;
}

function paginatePage(source: HTMLElement, orientation: PdfOrientation): HTMLElement[] {
  const pages: HTMLElement[] = [];
  let current = createEmptyPage(source, orientation);
  pages.push(current);

  const addPage = () => {
    current = createEmptyPage(source, orientation);
    pages.push(current);
    return current;
  };

  for (const node of Array.from(source.childNodes)) {
    const clone = node.cloneNode(true);
    current.appendChild(clone);
    if (!pageOverflows(current)) continue;

    clone.parentNode?.removeChild(clone);
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : null;
    if (element && splitTableBlock(element, current, addPage)) continue;
    if (element && splitChildContainer(element, current, addPage)) continue;

    if (current.childNodes.length > 0) addPage();
    current.appendChild(clone);
    if (pageOverflows(current)) current.dataset.pdfOversized = "true";
  }

  return pages.filter((page, index) => index === 0 || page.childNodes.length > 0);
}

export function preparePagedPdfDocument(doc: Document, orientation: PdfOrientation): HTMLElement[] {
  if (doc.documentElement.getAttribute(PAGED_ATTR) === "1") {
    return Array.from(doc.querySelectorAll<HTMLElement>(".page"));
  }

  const style = doc.createElement("style");
  style.setAttribute("data-pdf-paged-document", "1");
  style.textContent = `
    html,body{margin:0!important;padding:0!important;background:#e5e7eb!important}
    body{overflow:visible!important}
    .page{
      box-sizing:border-box!important;
      break-after:page!important;
      page-break-after:always!important;
      overflow:visible!important;
      max-height:none!important;
      box-shadow:0 2px 12px rgba(0,0,0,.16);
    }
    .page:last-child{break-after:auto!important;page-break-after:auto!important}
    @media print{
      html,body{background:#fff!important}
      .page{margin:0!important;box-shadow:none!important}
    }
  `;
  doc.head.appendChild(style);

  const originals = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
  const result: HTMLElement[] = [];
  for (const source of originals) {
    const pages = paginatePage(source, orientation);
    source.replaceWith(...pages);
    result.push(...pages);
  }

  doc.documentElement.setAttribute(PAGED_ATTR, "1");
  return result;
}

export function getPdfPageDiagnostics(doc: Document) {
  const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
  return {
    pages: pages.length,
    oversizedPages: pages.filter((page) => page.dataset.pdfOversized === "true").length,
    pageSizes: pages.map((page) => ({
      width: page.clientWidth,
      height: page.clientHeight,
      scrollWidth: page.scrollWidth,
      scrollHeight: page.scrollHeight,
    })),
  };
}
