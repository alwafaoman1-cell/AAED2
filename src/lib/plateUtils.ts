// ────────────────────────────────────────────────────────────────
// Plate utilities — central, single-source-of-truth
//
// Vehicle plates are stored split:
//   plate_number  : digits only          (e.g. "12345")
//   plate_letters : English letters only (e.g. "AA")
//   plate_country : ISO-ish country code (default "OM")
//
// Display format everywhere: "<letters> <digits>"   →  "AA 12345"
// ────────────────────────────────────────────────────────────────
import { supabase } from "@/integrations/supabase/client";
import { normalizePlateInput, toEnglishDigits } from "@/lib/formatters/numberFormat";

// Arabic plate letters commonly used in Oman → Latin equivalents
const AR_TO_LATIN: Record<string, string> = {
  ا: "A", ب: "B", ت: "T", ث: "T", ج: "J", ح: "H", خ: "K", د: "D", ذ: "D",
  ر: "R", ز: "Z", س: "S", ش: "S", ص: "S", ض: "D", ط: "T", ظ: "Z",
  ع: "A", غ: "G", ف: "F", ق: "Q", ك: "K", ل: "L", م: "M", ن: "N",
  ه: "H", و: "W", ي: "Y",
};

/** Extract digits only */
export function extractPlateDigits(input: string | null | undefined): string {
  return toEnglishDigits(input ?? "").replace(/[^0-9]/g, "");
}

/** Extract English letters only (Arabic → Latin), uppercased */
export function extractPlateLetters(input: string | null | undefined): string {
  let s = normalizePlateInput(input ?? "");
  // Translit Arabic letters → Latin
  s = Array.from(s).map((ch) => AR_TO_LATIN[ch] ?? ch).join("");
  return s.replace(/[^A-Z]/g, "");
}

/** Normalize a country code (default OM) */
export function normalizePlateCountry(input: string | null | undefined): string {
  return ((input ?? "").trim().toUpperCase()) || "OM";
}

/**
 * Try to split a free-form plate string into (letters, digits).
 * Useful for legacy data migration / pasted input.
 */
export function parseFullPlate(input: string | null | undefined): {
  letters: string;
  digits: string;
} {
  return {
    letters: extractPlateLetters(input),
    digits: extractPlateDigits(input),
  };
}

/**
 * Canonical display format used everywhere in the UI / PDFs.
 * Example:  formatPlate({ plate_letters:"AA", plate_number:"12345" }) → "AA 12345"
 */
export function formatPlate(v: {
  plate_letters?: string | null;
  plate_number?: string | null;
  plate?: string | null; // legacy local vehiclesStore shape
} | null | undefined): string {
  if (!v) return "—";
  const letters = normalizePlateInput(v.plate_letters ?? "");
  const digits = toEnglishDigits(v.plate_number ?? "").trim();
  if (letters || digits) return `${letters}${letters && digits ? " " : ""}${digits}`.trim() || "—";
  // Legacy fallback: single combined field
  if (v.plate) return normalizePlateInput(v.plate);
  return "—";
}

/** Validate that the user entered both parts correctly. Returns an error message or null. */
export function validatePlateParts(letters: string, digits: string): string | null {
  const L = extractPlateLetters(letters);
  const D = extractPlateDigits(digits);
  if (!D) return "رقم اللوحة مطلوب (أرقام فقط)";
  if (D.length > 7) return "رقم اللوحة طويل جداً (7 أرقام كحد أقصى)";
  if (!L) return "حروف اللوحة مطلوبة (إنجليزية A-Z)";
  if (L.length > 4) return "حروف اللوحة طويلة جداً (4 أحرف كحد أقصى)";
  return null;
}

/**
 * Look up an existing vehicle in cloud by (letters, digits, country).
 * Used by all "create vehicle" screens BEFORE inserting to prevent duplicates.
 */
export async function findVehicleByPlate(
  letters: string,
  digits: string,
  country: string = "OM",
): Promise<{
  id: string;
  customer_id: string;
  plate_number: string;
  plate_letters: string;
  plate_country: string;
  brand: string;
  model: string;
  year: number | null;
  color: string | null;
  archived: boolean;
} | null> {
  const L = extractPlateLetters(letters);
  const D = extractPlateDigits(digits);
  const C = normalizePlateCountry(country);
  if (!L || !D) return null;
  try {
    const { data, error } = await (supabase as any).rpc("find_vehicle_by_plate", {
      p_letters: L,
      p_digits: D,
      p_country: C,
    });
    if (error) {
      console.warn("[findVehicleByPlate]", error);
      return null;
    }
    const rows = (data as any[]) ?? [];
    // Prefer non-archived match
    return rows.find((r) => !r.archived) ?? rows[0] ?? null;
  } catch (e) {
    console.warn("[findVehicleByPlate] exception", e);
    return null;
  }
}
