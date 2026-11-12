/**
 * Rasterize the already-sanitized print DOM in an inert, style-isolated surface.
 * WebKit blocks html2canvas's clone-frame load/image callbacks when its owner
 * document is sandboxed. The untrusted preview/source keeps its scriptless
 * sandbox; only a frozen DOM clone is exposed to the trusted canvas renderer.
 */
export function createPdfCaptureSurface(source: HTMLElement) {
  const sourceDoc = source.ownerDocument;
  const sourceWindow = sourceDoc.defaultView;
  if (!sourceWindow) throw new Error("PDF source document is unavailable");

  const host = document.createElement("temo-pdf-capture");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  Object.assign(host.style, {
    position: "fixed", left: "-10000px", top: "0", display: "block",
    width: `${Math.max(source.scrollWidth, source.offsetWidth, 794)}px`,
    pointerEvents: "none", isolation: "isolate",
  });
  const shadow = host.attachShadow({ mode: "open" });
  const html = document.createElement("html");
  html.className = sourceDoc.documentElement.className;
  html.lang = sourceDoc.documentElement.lang;
  html.dir = sourceWindow.getComputedStyle(source).direction;
  const head = document.createElement("head");
  // These nodes have already passed sanitizePdfHtml; Shadow DOM contains their
  // style scope. Scripts, frames, forms and active attributes are not copied.
  for (const node of sourceDoc.head.querySelectorAll("style, link[rel=stylesheet]")) head.appendChild(node.cloneNode(true));
  const body = document.createElement("body");
  const element = source.cloneNode(true) as HTMLElement;
  body.appendChild(element); html.append(head, body); shadow.appendChild(html);

  const freezeStyle = (from: Element, to: Element) => {
    if (!("style" in to)) return;
    const computed = sourceWindow.getComputedStyle(from);
    const style = (to as HTMLElement | SVGElement).style;
    for (let i = 0; i < computed.length; i++) {
      const name = computed.item(i);
      style.setProperty(name, computed.getPropertyValue(name), "important");
    }
  };
  freezeStyle(sourceDoc.documentElement, html);
  freezeStyle(sourceDoc.body, body);
  const originals = [source, ...source.querySelectorAll("*")];
  const copies = [element, ...element.querySelectorAll("*")];
  originals.forEach((node, index) => freezeStyle(node, copies[index]));

  const addedFonts: FontFace[] = [];
  sourceDoc.fonts?.forEach((face) => {
    if (document.fonts && !document.fonts.has(face)) {
      document.fonts.add(face); addedFonts.push(face);
    }
  });
  document.body.appendChild(host);

  return {
    element,
    ignoreElement(node: Element) {
      if (node === document.documentElement || node === document.head || node === document.body || node === host) return false;
      // Never clone the application's background records, forms or scripts.
      if (node.getRootNode() !== shadow) return true;
      return node.classList.contains("print-bar") || node.classList.contains("no-print");
    },
    cleanup() {
      host.remove();
      addedFonts.forEach((face) => document.fonts.delete(face));
    },
  };
}
