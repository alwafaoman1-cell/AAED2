import DOMPurify from "dompurify";

/** Plain business fields are text, never a fragment of template markup. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Parent code must read/measure/paginate the document. Never add allow-scripts:
// combining it with allow-same-origin would let content escape this sandbox.
// allow-modals retains parent-initiated native print support.
export const PDF_HTML_SANDBOX = "allow-same-origin allow-modals";

function isSafePdfUrl(value: string, image = false): boolean {
  const url = value.trim();
  if (!url || Array.from(url).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  })) return false;
  if (image && /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)(?:;|,)/i.test(url)) return true;
  try {
    const protocol = new URL(url, typeof document === "undefined" ? "https://pdf.invalid/" : document.baseURI).protocol;
    return ["http:", "https:", "blob:"].includes(protocol)
      || (!image && ["mailto:", "tel:"].includes(protocol));
  } catch {
    return false;
  }
}

/** Validated AND attribute-escaped. Supports signatures, QR, Storage URLs and blobs. */
export function safePdfImageSrc(value: unknown): string {
  const url = String(value ?? "").trim();
  return isSafePdfUrl(url, true) ? escapeHtml(url) : "";
}

/**
 * Final boundary for generated legacy HTML, after all layout/QR additions and
 * before srcDoc/document.write/download. Not a replacement for escaping fields.
 * Keep template CSS, RTL, font stylesheets, tables, images and inline SVG QR.
 */
export function sanitizePdfHtml(html: string): string {
  const root = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    ADD_TAGS: ["style", "link", "meta"],
    ADD_ATTR: ["target", "dir", "lang"],
    // DOMPurify's default URI policy omits blob images used by local previews.
    // The stricter per-attribute check below still rejects active schemes.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "base", "form", "input", "button", "textarea", "select", "foreignobject", "animate", "set"],
    FORBID_ATTR: ["srcdoc", "action", "formaction", "ping"],
  });
  if (!(root instanceof Element)) throw new Error("PDF_HTML_SANITIZATION_FAILED");

  // Only remove nodes/attributes from DOMPurify's inert result. In particular,
  // do not allow meta refresh or attacker-provided policies/base URLs.
  root.querySelectorAll("meta").forEach((meta) => {
    if (!meta.hasAttribute("charset") && meta.getAttribute("name")?.toLowerCase() !== "viewport") meta.remove();
  });
  root.querySelectorAll("link").forEach((link) => {
    if (link.getAttribute("rel")?.toLowerCase() !== "stylesheet"
      || !isSafePdfUrl(link.getAttribute("href") || "", true)) link.remove();
  });
  root.querySelectorAll("*").forEach((element) => {
    for (const name of ["src", "href", "xlink:href", "poster", "background"]) {
      const value = element.getAttribute(name);
      if (value !== null && !isSafePdfUrl(value, name !== "href" && name !== "xlink:href")) element.removeAttribute(name);
    }
    // Preserve responsive image candidates, but not active/non-image schemes.
    // Entities have already been decoded by the inert HTML parser.
    const srcset = Array.from(element.getAttribute("srcset") || "").filter((character) => character.charCodeAt(0) > 32).join("");
    if (srcset && /(?:javascript|vbscript|file):|data:(?!image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)(?:;|,))/i.test(srcset)) {
      element.removeAttribute("srcset");
    }
    if (element.getAttribute("target") === "_blank") element.setAttribute("rel", "noopener noreferrer");
  });

  // Defense in depth also applies to downloaded HTML. Styles/fonts/images are
  // intentionally permitted; script execution and nested browsing are not.
  const policy = root.ownerDocument.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' http: https:; font-src http: https: data: blob:; img-src http: https: data: blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  root.querySelector("head")?.prepend(policy);
  return `<!DOCTYPE html>\n${root.outerHTML}`;
}
