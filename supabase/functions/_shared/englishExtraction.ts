/** Extraction language is independent of the application's display language. */
export const ENGLISH_ONLY_EXTRACTION_INSTRUCTION = [
  "Extract English text and Western digits only.",
  "Ignore Arabic text, Arabic-Indic numerals and fields whose value exists only in Arabic.",
  "Never translate or transliterate Arabic names, descriptions, values or labels.",
  "Use explicit English labels and the values printed beside them; never guess missing identifiers.",
  "If a value contains Arabic, return an empty string for that entire field rather than a partial name.",
].join(" ");

export function englishOnlyExtractedValue(value: unknown): string {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return "";
  const text = String(value).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "").trim();
  return /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(text) ? "" : text;
}
