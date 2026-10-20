import type { DocumentPage, DocumentType, ExtractedField, ExtractionIssue, ExtractionMethod, SourceBox } from "./types";

interface Candidate {
  key: string;
  raw: string;
  page: DocumentPage;
  box?: SourceBox;
  evidence: string[];
}

interface FieldRule {
  key: string;
  labels: string[];
  fallback?: RegExp;
}

const VEHICLE_RULES: FieldRule[] = [
  { key: "plate_number", labels: ["Plate No", "Plate Number", "رقم اللوحة", "رقم المركبة"], fallback: /(?:\bplate\b|اللوحة)\s*(?:no\.?|number|رقم)?\s*[:：-]?\s*([0-9٠-٩۰-۹]{2,7})/i },
  { key: "plate_letters", labels: ["Plate Code", "Plate Letters", "حروف اللوحة", "رمز اللوحة"] },
  { key: "plate_country", labels: ["Country", "الدولة", "بلد التسجيل"] },
  { key: "vin", labels: ["VIN", "Chassis No", "Chassis Number", "رقم الهيكل", "رقم الشاصي"], fallback: /\b([A-HJ-NPR-Z0-9]{17})\b/i },
  { key: "make", labels: ["Make", "Brand", "الماركة", "الصنع"] },
  { key: "model", labels: ["Model", "الموديل", "الطراز"] },
  { key: "year", labels: ["Model Year", "Year", "سنة الصنع", "سنة الموديل"] },
  { key: "owner_name", labels: ["Owner Name", "Vehicle Owner", "اسم المالك", "المالك"] },
  { key: "owner_phone", labels: ["Contact No", "Mobile", "Phone", "رقم التواصل", "هاتف المالك", "رقم الهاتف"] },
  { key: "registration_expiry", labels: ["Expiry Date", "Registration Expiry", "تاريخ انتهاء الملكية", "تاريخ الانتهاء"] },
  { key: "registration_date", labels: ["Registration Date", "تاريخ التسجيل"] },
  { key: "color", labels: ["Color", "Colour", "اللون"] },
  { key: "engine_number", labels: ["Engine No", "Engine Number", "رقم المحرك"] },
];

const INSURANCE_RULES: FieldRule[] = [
  { key: "claim_number", labels: ["Claim No", "Claim Number", "Claim Reference", "رقم المطالبة", "رقم المطالبة التأمينية", "رقم البلاغ", "رقم المرجع"], fallback: /\b(C\/[A-Z0-9/-]{8,})\b/i },
  { key: "insurance_company", labels: ["Insurance Company", "Insurer", "شركة التأمين", "شركة التامين"] },
  { key: "insured_name", labels: ["Insured Name", "Policy Holder", "اسم المؤمن له", "المؤمن له"] },
  { key: "accident_date", labels: ["Accident Date", "Date of Accident", "Incident Date", "Date of Loss", "تاريخ الحادث"] },
  { key: "approval_date", labels: ["Approval Date", "تاريخ الموافقة", "تاريخ الاعتماد"] },
  { key: "lpo_number", labels: ["LPO No", "LPO Number", "Repair Order No", "رقم أمر الإصلاح", "رقم الموافقة"] },
  { key: "estimate_number", labels: ["Estimate No", "Survey No", "رقم التقدير", "رقم المعاينة"] },
  { key: "approved_amount", labels: ["Approved Amount", "Approval Amount", "المبلغ المعتمد", "المبلغ الموافق عليه"] },
  { key: "excess", labels: ["Excess", "Deductible", "التحمل", "المبلغ المستقطع"] },
];

// A claim/approval is not a vehicle registration form. Registration dates and
// engine numbers are neither applied to the claim form nor reliable in its
// densely printed layout; extracting them only creates misleading review rows.
const CLAIM_VEHICLE_RULES = VEHICLE_RULES
  .filter((rule) => !["registration_date", "registration_expiry", "engine_number"].includes(rule.key))
  .map((rule) => rule.key === "plate_number"
    ? { ...rule, labels: [...rule.labels, "Vehicle No", "Registration No", "Registration Number"] }
    : rule.key === "owner_name"
      ? { ...rule, labels: [...rule.labels, "Name of Driver, Owner of the vehicle", "Name of Driver, Owner of", "Customer Name"] }
    : rule.key === "owner_phone"
      ? { ...rule, labels: [...rule.labels, "Customer Contact", "Customer Phone"] }
    : rule.key === "year"
      ? { ...rule, labels: [...rule.labels, "السنة"] }
    : rule);

const INVOICE_RULES: FieldRule[] = [
  { key: "supplier_name", labels: ["Supplier Name", "Vendor Name", "اسم المورد", "المورد"] },
  { key: "supplier_vatin", labels: ["VATIN", "VAT No", "VAT Number", "Tax Registration No", "الرقم الضريبي", "رقم ضريبة القيمة المضافة"] },
  { key: "invoice_number", labels: ["Invoice No", "Invoice Number", "رقم الفاتورة", "رقم الإيصال", "Receipt No"] },
  { key: "invoice_date", labels: ["Invoice Date", "Receipt Date", "تاريخ الفاتورة", "تاريخ الإيصال", "التاريخ"] },
  { key: "currency", labels: ["Currency", "العملة"] },
  { key: "subtotal", labels: ["Subtotal", "Sub Total", "Net Amount", "المجموع قبل الضريبة", "الإجمالي قبل الضريبة"] },
  { key: "vat", labels: ["VAT Amount", "VAT 5%", "ضريبة القيمة المضافة", "قيمة الضريبة", "VAT"] },
  { key: "discount", labels: ["Discount", "الخصم"] },
  { key: "total", labels: ["Grand Total", "Total Including VAT", "Total Amount", "الإجمالي شامل الضريبة", "الإجمالي", "Total"] },
  { key: "cr_number", labels: ["CR No", "Commercial Registration", "رقم السجل التجاري"] },
  { key: "payment_method", labels: ["Payment Method", "طريقة الدفع"] },
];

const TYPE_CLUES: Array<{ type: DocumentType; clues: Array<[RegExp, number]> }> = [
  { type: "vehicle_registration", clues: [[/vehicle\s+registration|registration\s+card|ملكية\s*(?:المركبة|السيارة)|رخصة\s*تسيير/i, 4], [/registration\s+expiry|تاريخ\s+انتهاء\s+الملكية/i, 2], [/plate\s*(?:no|number)|رقم\s+اللوحة/i, 1]] },
  { type: "insurance_approval", clues: [[/insurance\s+approval|approval\s+letter|خطاب\s+الموافقة|اعتماد\s+المطالبة/i, 4], [/approved\s+amount|المبلغ\s+المعتمد/i, 2], [/claim\s*(?:no|number)|رقم\s+المطالبة/i, 1]] },
  { type: "lpo", clues: [[/\bLPO\b|local\s+purchase\s+order|أمر\s+الإصلاح/i, 4], [/repair\s+order/i, 1]] },
  { type: "insurance_claim", clues: [[/insurance\s+claim|مطالبة\s+تأمين|مطالبة\s+التأمين/i, 4], [/repair\s+gate\s+pass|تصريح\s+المرور\s+لتصليح\s+المركبات/i, 4], [/\bC\/[A-Z0-9/-]{8,}\b/i, 4], [/claim\s*(?:no|number)|رقم\s+المطالبة/i, 2], [/insurance\s+company|شركة\s+التأمين/i, 1]] },
  { type: "damage_report", clues: [[/damage\s+report|تقرير\s+الأضرار|تقرير\s+الحادث/i, 4], [/damage\s+details|تفاصيل\s+الأضرار/i, 1]] },
  { type: "customer_id", clues: [[/identity\s+card|resident\s+card|بطاقة\s+الشخصية|البطاقة\s+المدنية/i, 4]] },
  { type: "supplier_invoice", clues: [[/supplier\s+invoice|فاتورة\s+مورد|tax\s+invoice|فاتورة\s+ضريبية/i, 3], [/supplier|المورد/i, 1], [/VATIN|الرقم\s+الضريبي/i, 1]] },
  { type: "purchase_invoice", clues: [[/purchase\s+invoice|فاتورة\s+مشتريات/i, 4], [/supplier|المورد/i, 1]] },
  { type: "expense_receipt", clues: [[/expense\s+receipt|payment\s+receipt|إيصال\s+مصروف|سند\s+صرف/i, 4], [/receipt\s*(?:no|number)|رقم\s+الإيصال/i, 1]] },
  { type: "quotation", clues: [[/quotation|quote\s*(?:no|number)|عرض\s+سعر|تقدير\s+تكلفة/i, 4]] },
  { type: "workshop_document", clues: [[/work\s+order|أمر\s+عمل|تقرير\s+الورشة/i, 4]] },
  { type: "invoice", clues: [[/invoice\s*(?:no|number)|رقم\s+الفاتورة/i, 2], [/subtotal|الإجمالي\s+قبل\s+الضريبة/i, 1]] },
];

export function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function detectLanguage(text: string): "ar" | "en" | "mixed" | "unknown" {
  const arabic = (text.match(/[\u0600-\u06ff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (arabic >= 4 && latin >= 4) return "mixed";
  if (arabic >= 4) return "ar";
  if (latin >= 4) return "en";
  return "unknown";
}

export function detectDocumentType(text: string, expected?: DocumentType): { type: DocumentType; confidence: number } {
  const ranked = TYPE_CLUES.map(({ type, clues }) => ({
    type,
    score: clues.reduce((sum, [pattern, weight]) => sum + (pattern.test(text) ? weight : 0), 0) + (type === expected ? 0.3 : 0),
  })).sort((a, b) => b.score - a.score);
  if (ranked[0].score < 2 || (ranked[1] && ranked[0].score - ranked[1].score < 0.5)) return { type: "unknown", confidence: 0 };
  return { type: ranked[0].type, confidence: Math.min(0.98, 0.35 + ranked[0].score * 0.09) };
}

function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function removeBidiControls(text: string): string { return text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ""); }

/** Normalization is for comparison only. The original OCR evidence is retained. */
export function normalizeArabicForComparison(text: string): string {
  return normalizeDigits(removeBidiControls(text).normalize("NFKC"))
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[\s\p{P}]+/gu, " ").trim().toLowerCase();
}

function valueNearLabel(text: string, label: string): string | null {
  const cleaned = removeBidiControls(text).trim();
  const escaped = escapeRegex(label);
  const after = cleaned.match(new RegExp(`^\\s*${escaped}\\s*(?:[:：#-]|\\s+)\\s*(.+)$`, "iu"));
  if (after?.[1]) return after[1].trim();
  // Mixed RTL OCR can output "value : label". Accept only an explicit separator.
  const before = cleaned.match(new RegExp(`^(.+?)\\s*[:：]\\s*${escaped}\\s*$`, "iu"));
  return before?.[1]?.trim() || null;
}

const ALL_FIELD_LABELS = [...VEHICLE_RULES, ...CLAIM_VEHICLE_RULES, ...INSURANCE_RULES, ...INVOICE_RULES]
  .flatMap((rule) => rule.labels)
  .filter((label) => label.length >= 4);

function containsAnotherFieldLabel(text: string): boolean {
  const normalized = normalizeArabicForComparison(text);
  return ALL_FIELD_LABELS.some((label) => normalized.includes(normalizeArabicForComparison(label)));
}

function isStandaloneFieldLabel(text: string): boolean {
  const normalized = normalizeArabicForComparison(text);
  return ALL_FIELD_LABELS.some((label) => normalized === normalizeArabicForComparison(label));
}

function continuesFieldLabel(rule: FieldRule, matchedLabel: string, value: string): boolean {
  const prefix = normalizeArabicForComparison(`${matchedLabel} ${value}`);
  return rule.labels.some((label) => normalizeArabicForComparison(label) === prefix);
}

function labelEvidence(rule: FieldRule, label: string, layout = false): string[] {
  const evidence = ["label", ...(layout ? ["layout"] : [])];
  if (rule.key === "owner_name" && normalizeArabicForComparison(label).includes("name of driver owner of")) {
    evidence.push("ambiguous_driver_or_owner");
  }
  return evidence;
}

function plateComponents(raw: string): { number: string; letters?: string } | null {
  const value = normalizeDigits(removeBidiControls(raw)).trim();
  const digitsFirst = value.match(/^(\d{1,7})(?:\s*[/-]?\s*([A-Za-z\u0600-\u06ff]{1,3}(?:\s+[A-Za-z\u0600-\u06ff]{1,3})?))?$/u);
  if (digitsFirst) return { number: digitsFirst[1], letters: digitsFirst[2]?.replace(/\s/g, "").toUpperCase() };
  const lettersFirst = value.match(/^([A-Za-z\u0600-\u06ff]{1,3}(?:\s+[A-Za-z\u0600-\u06ff]{1,3})?)\s*(?:\/|\s)\s*(\d{1,7})$/u);
  return lettersFirst ? { number: lettersFirst[2], letters: lettersFirst[1].replace(/\s/g, "").toUpperCase() } : null;
}

function plausibleFieldEvidence(key: string, raw: string): boolean {
  const value = normalizeDigits(removeBidiControls(raw)).trim();
  // A nearby heading or narrative paragraph is not a damaged identifier.
  // Leave the field empty for review instead of presenting it as an OCR value.
  if (key === "vin") {
    const compact = value.replace(/[\s-]/g, "");
    return /^[A-Za-z0-9\s-]{15,30}$/.test(value) && compact.length >= 15 && compact.length <= 19;
  }
  if (key.endsWith("_date") || key === "registration_expiry")
    return /\d{1,4}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4}|^\s*\d{8}\s*$/.test(value);
  if (key === "plate_number") return /\d/.test(value) && value.length <= 24;
  if (key === "make" || key === "model") return normalizeCandidate(key, value).valid && !isStandaloneFieldLabel(value) && !/^[/:：-]/u.test(value);
  if (key === "insurance_company") return value.length >= 3 && /[\p{L}]{3}/u.test(value) && !/https?:\/\/|www\.|@/i.test(value);
  return true;
}

/** Some insurer gate passes print one shared vehicle make/model cell. Split only
 * when an explicit separator is present; otherwise leave both for review. */
function findCombinedMakeModel(pages: DocumentPage[]): { make: Candidate; model: Candidate } | null {
  const combinedLabels = ["Vehicle Make & Model", "Make & Model", "Make / Model"];
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).map((line) => removeBidiControls(line).trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
      for (const label of combinedLabels) {
        const exactLabel = normalizeArabicForComparison(lines[index]) === normalizeArabicForComparison(label);
        const raw = exactLabel ? lines[index + 1] : valueNearLabel(lines[index], label);
        const parts = raw?.match(/^(.{2,40}?)\s*[-–—/]\s*(.{2,40})$/u);
        if (!parts || !normalizeCandidate("make", parts[1]).valid || !normalizeCandidate("model", parts[2]).valid) continue;
        const source = page.segments?.find((segment) => segment.text.includes(raw!));
        const candidate = { page, box: source?.box, evidence: ["label", "combined_vehicle_name"] };
        return {
          make: { ...candidate, key: "make", raw: parts[1].trim() },
          model: { ...candidate, key: "model", raw: parts[2].trim() },
        };
      }
    }
  }
  return null;
}

function findInsurerHeader(pages: DocumentPage[]): Candidate | null {
  const page = pages[0];
  if (!page) return null;
  const lines = page.text.split(/\r?\n/).map((line) => removeBidiControls(line).trim()).filter(Boolean);
  const claimIndex = lines.findIndex((line) => /\bC\/[A-Z0-9/-]{8,}\b|claim\s*(?:no|number)|رقم\s*المطالبة/i.test(line));
  const header = lines.slice(0, claimIndex < 0 ? 10 : Math.min(claimIndex, 12));
  const names = header.filter((line) => line.length >= 6 && line.length <= 60 &&
    line.split(/\s+/).length >= 2 &&
    /\b(?:takaful|insurance)\b|تكافل|للتأمين/iu.test(line) &&
    !/^(?:insurance\s+company|شركة\s+التأمين)$/iu.test(line));
  const raw = names.find((line) => /\b(?:takaful|insurance)\b/i.test(line)) || names[0];
  if (!raw) return null;
  const source = page.segments?.find((segment) => segment.text.includes(raw));
  return { key: "insurance_company", raw, page, box: source?.box, evidence: ["insurer_header"] };
}

function findCandidate(pages: DocumentPage[], rule: FieldRule): Candidate | null {
  const candidates: Candidate[] = [];
  const addCandidate = (candidate: Candidate) => {
    if (plausibleFieldEvidence(candidate.key, candidate.raw)) candidates.push(candidate);
  };
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).map((line) => removeBidiControls(line).trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index++) {
      for (const label of [...rule.labels].sort((a, b) => b.length - a.length)) {
        const exactLabel = normalizeArabicForComparison(lines[index]) === normalizeArabicForComparison(label);
        const inline = valueNearLabel(lines[index], label);
        const next = exactLabel && lines[index + 1] && !containsAnotherFieldLabel(lines[index + 1])
          ? lines[index + 1] : "";
        const raw = (inline || next || "").trim();
        if (!raw || raw.length > 160) continue;
        if (!inline && !exactLabel) continue;
        if (continuesFieldLabel(rule, label, raw)) continue;
        const source = page.segments?.find((item) => item.text.includes(raw) || item.text.includes(label));
        addCandidate({ key: rule.key, raw, page, box: source?.box,
          evidence: labelEvidence(rule, label) });
      }
    }
  }
  // Structured OCR keeps line boxes. A value in the adjacent cell is more
  // trustworthy than the next unrelated text line in flattened page text.
  for (const page of pages) {
    if (!page.segments?.length || !page.width || !page.height) continue;
    // Some Arabic OCR engines split a single printed line into separate
    // right-to-left fragments (e.g. "شركة" + "التأمين ..." or
    // "رقم" + "اللوحة" + plate digits). Reconstruct only same-row,
    // nearby fragments and retain the value segment as evidence.
    if (rule.key === "insurance_company" || rule.key === "plate_number") {
      for (const anchor of page.segments.filter((segment) => !!segment.box)) {
        const center = anchor.box!.y + anchor.box!.height / 2;
        const row = page.segments.filter((segment) => segment.box &&
          Math.abs(segment.box.y + segment.box.height / 2 - center) < Math.max(segment.box.height, anchor.box!.height) * 0.55 &&
          Math.abs(segment.box.x - anchor.box!.x) < page.width! * 0.5)
          .sort((a, b) => b.box!.x - a.box!.x);
        if (row.length < 2 || row.length > 5) continue;
        const combined = row.map((segment) => segment.text.trim()).join(" ").trim();
        for (const label of rule.labels.filter((text) => /[\u0600-\u06ff]/.test(text))) {
          const offset = combined.indexOf(label);
          if (offset < 0) continue;
          const raw = combined.slice(offset + label.length).replace(/^\s*[:：-]\s*/, "").trim();
          if (!raw || raw.length > 160 || containsAnotherFieldLabel(raw)) continue;
          const source = row.find((segment) => segment.text.trim() === raw) || row.find((segment) => segment.text.includes(raw));
          addCandidate({ key: rule.key, raw, page, box: source?.box, evidence: ["label", "layout"] });
        }
      }
    }
    const labelSegments = page.segments.filter((segment) => rule.labels.some((label) =>
      normalizeArabicForComparison(segment.text).includes(normalizeArabicForComparison(label))));
    for (const labelSegment of labelSegments) {
      if (!labelSegment.box) continue;
      const matchedLabel = [...rule.labels].sort((a, b) => b.length - a.length).find((label) =>
        normalizeArabicForComparison(labelSegment.text).includes(normalizeArabicForComparison(label)));
      if (!matchedLabel) continue;
      const inline = valueNearLabel(labelSegment.text, matchedLabel);
      if (inline && !continuesFieldLabel(rule, matchedLabel, inline)) {
        addCandidate({ key: rule.key, raw: inline, page, box: labelSegment.box, evidence: labelEvidence(rule, matchedLabel, true) });
      }
      const midY = labelSegment.box.y + labelSegment.box.height / 2;
      // Dense gate-pass tables put the model year immediately above the plate.
      // A loose vertical radius can incorrectly accept that year as a valid
      // plate number. Numeric identity cells must overlap the label's row.
      const rowTolerance = ["plate_number", "year", "owner_name"].includes(rule.key) ? 0.65 : 1.4;
      const neighbors = page.segments.filter((segment) => segment !== labelSegment && segment.box &&
        !containsAnotherFieldLabel(segment.text) &&
        !continuesFieldLabel(rule, matchedLabel, segment.text.trim()) &&
        Math.abs(segment.box.y + segment.box.height / 2 - midY) < Math.max(labelSegment.box.height, segment.box.height) * rowTolerance &&
        Math.abs(segment.box.x - labelSegment.box.x) < page.width! * 0.55);
      neighbors.sort((a, b) => Math.abs(a.box!.x - labelSegment.box!.x) - Math.abs(b.box!.x - labelSegment.box!.x));
      const nearest = neighbors[0];
      if (nearest && nearest.text.trim().length <= 160) {
        const neighboringDigits = normalizeDigits(nearest.text.trim());
        const inlineDigits = normalizeDigits(labelSegment.text).match(/\d{1,7}$/)?.[0] || "";
        const distinctPlateValue = rule.key === "plate_number" && /^\d{2,7}$/.test(neighboringDigits)
          && neighboringDigits.length > inlineDigits.length;
        addCandidate({ key: rule.key, raw: nearest.text.trim(), page, box: nearest.box,
          evidence: [...labelEvidence(rule, matchedLabel, true), ...(distinctPlateValue ? ["adjacent_value"] : [])] });
      }
    }
  }
  if (rule.fallback) {
    for (const page of pages) {
      const match = removeBidiControls(page.text).match(rule.fallback);
      if (!match?.[1]) continue;
      const raw = match[1].trim();
      const source = page.segments?.find((item) => item.text.includes(raw));
      addCandidate({ key: rule.key, raw, page, box: source?.box, evidence: ["pattern"] });
    }
  }
  // A geometrically nearby or first-seen candidate must never outrank a
  // validated identifier found elsewhere on the same page.
  candidates.sort((a, b) => {
    const rank = (candidate: Candidate) => (normalizeCandidate(candidate.key, candidate.raw).valid ? 10 : 0)
      + (candidate.evidence.includes("layout") ? 2 : 0)
      + (candidate.evidence.includes("label") ? 1 : 0)
      + (candidate.evidence.includes("adjacent_value") ? 1 : 0)
      - (candidate.key === "plate_number" && candidate.page.method === "ocr" && /^\d$/.test(normalizeDigits(candidate.raw)) ? 3 : 0);
    return rank(b) - rank(a);
  });
  return candidates[0] || null;
}

export function parseMoneyMilli(raw: string): number | null {
  const input = normalizeDigits(raw).replace(/\s|OMR|ر\.?ع\.?/gi, "").replace(/[^0-9.,-]/g, "");
  if (!input) return null;
  let normalized = input;
  if (input.includes(",") && input.includes(".")) normalized = input.replace(/,/g, "");
  else if (input.includes(",")) normalized = /,\d{1,3}$/.test(input) ? input.replace(",", ".") : input.replace(/,/g, "");
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const [whole, decimals = ""] = normalized.replace(/^-/, "").split(".");
  const milli = (negative ? -1 : 1) * (Number(whole) * 1000 + Number(decimals.padEnd(3, "0")));
  return Number.isSafeInteger(milli) ? milli : null;
}

function normalizeDate(raw: string): string | null {
  const value = normalizeDigits(raw);
  const match = value.match(/\b(\d{1,4})[/-](\d{1,2})[/-](\d{2,4})\b/);
  const compact = !match && value.match(/^\s*(\d{8})\s*$/);
  if (!match && !compact) return null;
  const isoFirst = !!match && match[1].length === 4;
  const sourceYear = match ? (isoFirst ? match[1] : match[3]) : compact![1].slice(4);
  const parsedYear = Number(sourceYear);
  const year = sourceYear.length === 2 ? (parsedYear <= 79 ? 2000 + parsedYear : 1900 + parsedYear) : parsedYear;
  const month = match ? Number(match[2]) : Number(compact![1].slice(2, 4));
  const day = match ? (isoFirst ? Number(match[3]) : Number(match[1])) : Number(compact![1].slice(0, 2));
  // Without printed separators, only an unambiguous day > 12 may be decoded.
  // Do not infer a date from an 8-digit OCR result that could be mm/dd/yyyy.
  if (compact && day <= 12) return null;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeCandidate(key: string, raw: string): { value: string; valid: boolean; reason?: string } {
  const value = normalizeDigits(removeBidiControls(raw)).trim().replace(/\s+/g, " ");
  if (/^line_item_\d{1,2}_name$/.test(key)) return { value, valid: value.length >= 2 && value.length <= 160, reason: "LINE_ITEM_NAME_INVALID" };
  if (/^line_item_\d{1,2}_qty$/.test(key)) {
    const qty = Number(value.replace(",", "."));
    return { value: String(qty), valid: /^\d{1,5}(?:[.,]\d{1,3})?$/.test(value) && qty > 0 && qty <= 100_000, reason: "LINE_ITEM_QTY_INVALID" };
  }
  if (/^line_item_\d{1,2}_(?:unit_price|total)$/.test(key)) {
    const milli = parseMoneyMilli(value);
    return { value: milli === null ? value : (milli / 1000).toFixed(3), valid: milli !== null && milli >= 0, reason: "LINE_ITEM_AMOUNT_INVALID" };
  }
  if (key === "vin") {
    const vin = value.toUpperCase().replace(/\s|-/g, "");
    return { value: vin, valid: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin), reason: "VIN_FORMAT_INVALID" };
  }
  if (key.endsWith("_date") || key === "registration_expiry") {
    const date = normalizeDate(value);
    return { value: date || value, valid: !!date, reason: "DATE_INVALID" };
  }
  if (["subtotal", "vat", "total", "discount", "approved_amount", "excess"].includes(key)) {
    const milli = parseMoneyMilli(value);
    return { value: milli === null ? value : (milli / 1000).toFixed(3), valid: milli !== null, reason: "AMOUNT_INVALID" };
  }
  if (key === "year") return { value: value.match(/\b(?:19|20)\d{2}\b/)?.[0] || value, valid: /^(?:19|20)\d{2}$/.test(value), reason: "YEAR_INVALID" };
  if (key === "plate_number") {
    const plate = plateComponents(value);
    return { value: plate?.number || value, valid: !!plate, reason: "PLATE_INVALID" };
  }
  if (key === "plate_letters") {
    const letters = value.replace(/\s/g, "").toUpperCase();
    return { value: letters, valid: /^[A-Z\u0600-\u06ff]{1,6}$/.test(letters), reason: "PLATE_CODE_INVALID" };
  }
  if (key === "make" || key === "model") {
    const plateReference = /^[A-Za-z\u0600-\u06ff]{1,3}(?:\s+[A-Za-z\u0600-\u06ff]{1,3})?\s*\/\s*\d{2,7}$/u.test(value);
    return { value, valid: !plateReference && value.length >= 2 && value.length <= 60 && /[A-Za-z\u0600-\u06ff]/u.test(value), reason: "VEHICLE_NAME_INVALID" };
  }
  if (key === "owner_phone") return { value: value.replace(/[^\d+]/g, ""), valid: /^\+?\d{8,15}$/.test(value.replace(/[^\d+]/g, "")), reason: "PHONE_INVALID" };
  if (key === "claim_number") return { value, valid: value.length >= 4 && value.length <= 80 && /\d/.test(value) && !/[\n\r]/.test(value), reason: "CLAIM_NUMBER_INVALID" };
  if (key === "invoice_number" || key === "lpo_number") return { value, valid: value.length >= 3 && value.length <= 80, reason: "REFERENCE_INVALID" };
  if (key === "supplier_vatin") return { value: value.replace(/\s/g, "").toUpperCase(), valid: /^[A-Z0-9-]{8,30}$/i.test(value.replace(/\s/g, "")), reason: "VATIN_INVALID" };
  return { value, valid: value.length > 0 };
}

function rulesForDocumentType(type?: DocumentType): FieldRule[] {
  if (type === "vehicle_registration") return VEHICLE_RULES;
  if (["insurance_claim", "insurance_approval", "lpo", "damage_report"].includes(type || "")) {
    return [...INSURANCE_RULES, ...CLAIM_VEHICLE_RULES];
  }
  if (["supplier_invoice", "purchase_invoice", "expense_receipt", "invoice", "quotation"].includes(type || "")) {
    return INVOICE_RULES;
  }
  return [];
}

export function parseDocumentPages(pages: DocumentPage[], expected?: DocumentType): {
  type: DocumentType;
  typeConfidence: number;
  language: "ar" | "en" | "mixed" | "unknown";
  fields: Record<string, ExtractedField>;
  issues: ExtractionIssue[];
} {
  const text = pages.map((page) => page.text).join("\n");
  const detected = detectDocumentType(text, expected);
  // A mixed PDF may mention invoices more often than the claim form it was
  // attached to. Keep the independent type warning, but extract candidates
  // relevant to the form being reviewed. The mismatch still deselects every
  // candidate until the user explicitly verifies it.
  const expectedRules = rulesForDocumentType(expected);
  const rules = expectedRules.length ? expectedRules : rulesForDocumentType(detected.type);
  const fields: Record<string, ExtractedField> = {};
  const issues: ExtractionIssue[] = [];
  const combinedVehicleName = rules.some((rule) => rule.key === "make") ? findCombinedMakeModel(pages) : null;
  const relatedInsuranceDocument = expected === "insurance_claim" &&
    ["insurance_approval", "lpo", "damage_report"].includes(detected.type);
  if (expected && detected.type !== "unknown" && detected.type !== expected && !relatedInsuranceDocument) {
    issues.push({ code: "DOCUMENT_TYPE_MISMATCH", severity: "warning", message: `Detected ${detected.type}; expected ${expected}. Confirm the document before applying any fields.` });
  }
  for (const rule of rules) {
    if (fields[rule.key]) continue;
    const candidate = rule.key === "make" || rule.key === "model"
      ? combinedVehicleName?.[rule.key] || findCandidate(pages, rule)
      : findCandidate(pages, rule);
    if (!candidate) continue;
    const normalized = normalizeCandidate(rule.key, candidate.raw);
    const method: ExtractionMethod = candidate.page.method;
    const score = Math.max(0, Math.min(0.99,
      candidate.page.confidence * 0.68 +
      (candidate.evidence.includes("label") ? 0.12 : 0.03) +
      (normalized.valid ? 0.12 : -0.2) +
      detected.confidence * 0.08,
    ));
    const ambiguousOwner = rule.key === "owner_name" && candidate.evidence.includes("ambiguous_driver_or_owner");
    fields[rule.key] = {
      key: rule.key, rawValue: candidate.raw, normalizedValue: normalized.value,
      confidence: Number((ambiguousOwner ? Math.min(score, 0.6) : score).toFixed(3)), sourcePage: candidate.page.number,
      sourceBox: candidate.box, method, validation: normalized.valid && !ambiguousOwner ? "valid" : "warning",
      evidence: candidate.evidence,
    };
    if (ambiguousOwner) issues.push({ code: "DRIVER_OR_OWNER_REVIEW_REQUIRED", severity: "warning", field: rule.key,
      message: "The document labels this person as driver or owner; confirm their role before applying the name." });
    if (!normalized.valid) issues.push({ code: normalized.reason || "FIELD_INVALID", severity: "warning", field: rule.key, message: `${rule.key} could not be validated.` });
  }
  if (rules.some((rule) => rule.key === "insurance_company") && !fields.insurance_company) {
    const header = findInsurerHeader(pages);
    if (header) fields.insurance_company = {
      key: "insurance_company", rawValue: header.raw, normalizedValue: header.raw,
      confidence: 0.6, sourcePage: header.page.number, sourceBox: header.box,
      method: header.page.method, validation: "warning", evidence: header.evidence,
    };
  }
  if (!fields.plate_letters && fields.plate_number) {
    const plate = plateComponents(fields.plate_number.rawValue);
    if (plate?.letters) fields.plate_letters = {
      ...fields.plate_number, key: "plate_letters", rawValue: plate.letters, normalizedValue: plate.letters,
      confidence: Math.max(0, fields.plate_number.confidence - 0.04), evidence: ["plate_combination"],
    };
  }
  const subtotal = fields.subtotal && parseMoneyMilli(fields.subtotal.normalizedValue);
  const vat = fields.vat && parseMoneyMilli(fields.vat.normalizedValue);
  const total = fields.total && parseMoneyMilli(fields.total.normalizedValue);
  const discount = fields.discount && parseMoneyMilli(fields.discount.normalizedValue);
  if (subtotal !== undefined && subtotal !== null && vat !== undefined && vat !== null && total !== undefined && total !== null) {
    const difference = Math.abs(subtotal + vat - (discount || 0) - total);
    if (difference > 1) {
      issues.push({ code: "VAT_TOTAL_MISMATCH", severity: "warning", field: "total", message: "Subtotal + VAT - discount does not equal total (OMR, 3 decimals)." });
      fields.total.validation = "warning";
      fields.total.confidence = Math.max(0, fields.total.confidence - 0.2);
    }
  }
  if (Object.keys(fields).length === 0) issues.push({ code: "NO_FIELDS_RECOGNIZED", severity: "warning", message: "No reliable fields were recognized. Review the document manually." });
  return { type: detected.type, typeConfidence: detected.confidence, language: detectLanguage(text), fields, issues };
}
