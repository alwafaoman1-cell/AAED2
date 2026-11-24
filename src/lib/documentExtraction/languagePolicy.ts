import type { DocumentPage } from "./types";

// Include Arabic-Indic digits and presentation forms. They are ignored rather
// than transliterated into plausible identifiers in the English-only pipeline.
const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
const ARABIC_RUNS = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]+/gu;
// Prefix/lookahead boundaries also work in Safari without lookbehind. Slash
// references such as C/VIN/ABC/2026 are identifiers, not English labels/words.
const ENGLISH_ANCHOR = /(?:^|[^A-Za-z0-9/])(?:claim|insurance|policy|invoice|receipt|registration|plate|vin|chassis|owner|customer|supplier|tax|vat|vatin|lpo|repair|vehicle|amount|date|make|model|year|color|colour|phone|telephone|mobile|address|quantity|description|subtotal|total|expense|purchase|workshop|delivery|quotation|estimate|accident|loss|regn)(?=$|[^A-Za-z0-9/])/i;
const ENGLISH_WORD = /(?:^|[^A-Za-z0-9/])([A-Za-z][A-Za-z'-]{2,})(?=$|[^A-Za-z0-9/])/g;
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function containsArabicScript(value: string): boolean {
  return ARABIC_SCRIPT.test(value);
}

/** Never manufacture a Latin fragment by stripping Arabic out of a value. */
export function englishOnlyValue(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  const text = String(value).replace(BIDI_CONTROLS, "").trim();
  return containsArabicScript(text) ? "" : text;
}

function englishLine(line: string): string {
  line = line.replace(BIDI_CONTROLS, "");
  if (!containsArabicScript(line)) return line.trim();
  const colon = line.search(/[:：]/u);
  // Do not turn "Owner Name: أحمد ALI" into the invented partial name ALI.
  if (!ENGLISH_ANCHOR.test(line) || colon < 0 || containsArabicScript(line.slice(colon + 1))) return "";
  return line.replace(ARABIC_RUNS, " ")
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s*\/\s*(?=[:：])/g, "")
    .replace(/[ \t]+/g, " ").trim();
}

/** Copies only English evidence; never changes stored or finalized page objects. */
export function englishDocumentPages(pages: DocumentPage[]): DocumentPage[] {
  return pages.map(page => {
    const original = page.text || "";
    const text = original.split(/\r?\n/).map(englishLine).filter(Boolean).join("\n");
    const hasEnglishEvidence = ENGLISH_ANCHOR.test(text) ||
      (page.method === "native_pdf" && !containsArabicScript(original) && (text.match(ENGLISH_WORD) || []).length >= 3);
    if (!hasEnglishEvidence) return { ...page, text: "", segments: [] };
    const flattened = text.replace(/\s+/g, " ");
    const segments = (page.segments || []).flatMap(segment => {
      const value = englishLine(segment.text);
      if (!value || containsArabicScript(value) || !flattened.includes(value.replace(/\s+/g, " "))) return [];
      return [{ ...segment, text: value }];
    });
    return { ...page, text, segments };
  });
}

export function englishOnlyText(text: string): string {
  return englishDocumentPages([{ number: 1, text, method: "native_pdf", confidence: 1 }])[0].text;
}
