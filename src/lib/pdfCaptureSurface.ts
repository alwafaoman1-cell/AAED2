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
  const stylesheetLoads: Promise<void>[] = [];
  for (const node of sourceDoc.head.querySelectorAll("style, link[rel=stylesheet]")) {
    const copy = node.cloneNode(true) as HTMLElement;
    let importsStylesheet = false;
    if (node.tagName === "STYLE") {
      try {
        const sheet = (node as HTMLStyleElement).sheet;
        importsStylesheet = sheet ? Array.from(sheet.cssRules).some((rule) => rule.type === 3) : /@import\b/i.test(node.textContent || "");
      } catch { importsStylesheet = /@import\b/i.test(node.textContent || ""); }
    }
    if (node.tagName === "LINK" || importsStylesheet) {
      stylesheetLoads.push(new Promise<void>((resolve) => {
        const settled = () => {
          copy.removeEventListener("load", settled);
          copy.removeEventListener("error", settled);
          resolve();
        };
        copy.addEventListener("load", settled);
        copy.addEventListener("error", settled);
      }));
    }
    head.appendChild(copy);
  }
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

  document.body.appendChild(host);
  const addedFonts: FontFace[] = [];
  const nativeFonts: { face: FontFace; error: unknown }[] = [];
  const cleanup = () => {
    host.remove();
    addedFonts.forEach((face) => document.fonts.delete(face));
  };
  let ready: Promise<void>;
  try {
    // Discover the copied CSS before obtaining fonts.ready. WebKit registers
    // its own faces from shadow stylesheets; Chromium still needs the existing
    // object transfer for fonts ignored in shadow CSS.
    element.getBoundingClientRect();
    sourceDoc.fonts?.forEach((face) => {
      if (!document.fonts || document.fonts.has(face)) return;
      try {
        document.fonts.add(face);
        addedFonts.push(face);
      } catch (error) {
        // CSS-connected faces cannot be transferred in WebKit. Accept only
        // that defined rejection, then verify its native CSS replacement below.
        if (!(error && typeof error === "object" && "name" in error && error.name === "InvalidModificationError")) throw error;
        nativeFonts.push({ face, error });
      }
    });
    ready = Promise.all(stylesheetLoads).then(async () => {
      // An already-resolved FontFaceSet.ready does not include a stylesheet
      // still loading its @import. Wait for it first, then discover its fonts.
      element.getBoundingClientRect();
      await document.fonts?.ready;
      const descriptors = ["family", "style", "weight", "stretch", "unicodeRange"] as const;
      for (const { face, error } of nativeFonts) {
        let registered = false;
        document.fonts.forEach((candidate) => {
          if (candidate !== face && descriptors.every((name) => candidate[name] === face[name])) registered = true;
        });
        // Do not turn a font error into a PDF silently rendered with fallback.
        if (!registered) throw error;
      }
    });
  } catch (error) {
    cleanup();
    throw error;
  }

  return {
    element,
    ready,
    ignoreElement(node: Element) {
      if (node === document.documentElement || node === document.head || node === document.body || node === host) return false;
      // Never clone the application's background records, forms or scripts.
      if (node.getRootNode() !== shadow) return true;
      return node.classList.contains("print-bar") || node.classList.contains("no-print");
    },
    cleanup,
  };
}
