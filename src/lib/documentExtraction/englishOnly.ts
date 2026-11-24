import { parseDocumentPages, type ParseDocumentOptions } from "./parsers";
import { containsArabicScript, englishDocumentPages } from "./languagePolicy";
import type { DocumentPage, DocumentType } from "./types";

export { containsArabicScript, englishDocumentPages } from "./languagePolicy";

/** Separate entry point: historical bilingual evidence is never reparsed in place. */
export function parseEnglishDocumentPages(pages: DocumentPage[], expected?: DocumentType, options: ParseDocumentOptions = {}) {
  const englishPages = englishDocumentPages(pages);
  const parsed = parseDocumentPages(englishPages, expected, {
    ...options, vehicleMakes: options.vehicleMakes?.filter(make => !containsArabicScript(make)),
  });
  for (const [key, field] of Object.entries(parsed.fields)) {
    if (containsArabicScript(field.rawValue) || containsArabicScript(field.normalizedValue)) delete parsed.fields[key];
  }
  parsed.language = englishPages.some(page => /[A-Za-z]/.test(page.text)) ? "en" : "unknown";
  if (!Object.keys(parsed.fields).length) parsed.issues.push({
    code: "ENGLISH_ONLY_NO_RELIABLE_FIELDS", severity: "warning",
    message: "No reliable English fields were found. Arabic content was ignored. Review manually or provide an English document.",
  });
  return parsed;
}
