import type { DocumentPage, ExtractedField, ExtractionIssue, SourceSegment } from "./types";
import { normalizeDigits, parseMoneyMilli } from "./parsers";

const COLUMN_LABELS = {
  name: /^(?:description|item|particulars|الصنف|البيان|الوصف|اسم الصنف)$/i,
  qty: /^(?:qty|quantity|الكمية|كمية)$/i,
  unit_price: /^(?:rate|unit\s*price|price|سعر\s*الوحدة|سعر\s*الوحدة\s*ر\.ع|السعر)$/i,
  total: /^(?:total|amount|line\s*total|الإجمالي|المجموع|المبلغ)$/i,
} as const;
const ITEM_KEY = /^line_item_(\d{1,2})_(name|qty|unit_price|total)$/;
const MAX_ROWS = 16; // 4 fields per row + document header remain below the review RPC's 100-field cap.

type Column = keyof typeof COLUMN_LABELS;
type Positioned = SourceSegment & { box: NonNullable<SourceSegment["box"]> };
type Row = Positioned[];

export function isPurchaseLineField(key: string): boolean { return ITEM_KEY.test(key); }

function rows(segments: SourceSegment[]): Row[] {
  const positioned = segments.filter((segment): segment is Positioned => !!segment.box && !!segment.text.trim())
    .sort((a, b) => a.box.y + a.box.height / 2 - b.box.y - b.box.height / 2);
  const grouped: Row[] = [];
  for (const segment of positioned) {
    const center = segment.box.y + segment.box.height / 2;
    const current = grouped[grouped.length - 1];
    if (current && Math.abs(center - (current[0].box.y + current[0].box.height / 2)) <=
      Math.min(segment.box.height, current[0].box.height) * 0.45) current.push(segment);
    else grouped.push([segment]);
  }
  return grouped;
}

function headerColumns(row: Row): Partial<Record<Column, Positioned>> {
  const found: Partial<Record<Column, Positioned>> = {};
  for (const segment of row) {
    const text = segment.text.trim().replace(/[:：]/g, "");
    for (const [column, pattern] of Object.entries(COLUMN_LABELS) as [Column, RegExp][]) {
      if (pattern.test(text)) found[column] = segment;
    }
  }
  return found;
}

function itemFields(page: DocumentPage, row: Row, header: Record<Column, Positioned>, ordinal: number): Record<string, ExtractedField> | null {
  const centers = Object.fromEntries((Object.keys(header) as Column[]).map((key) =>
    [key, header[key].box.x + header[key].box.width / 2])) as Record<Column, number>;
  const assigned: Record<Column, Positioned[]> = { name: [], qty: [], unit_price: [], total: [] };
  for (const segment of row) {
    const x = segment.box.x + segment.box.width / 2;
    const column = (Object.keys(centers) as Column[]).sort((a, b) => Math.abs(centers[a] - x) - Math.abs(centers[b] - x))[0];
    assigned[column].push(segment);
  }
  if (Object.values(assigned).some((cell) => cell.length !== 1)) return null;
  const raw = Object.fromEntries((Object.keys(assigned) as Column[]).map((key) => [key, assigned[key][0].text.trim()])) as Record<Column, string>;
  const qtyText = normalizeDigits(raw.qty);
  // A lone comma before three digits can mean thousands or three decimals.
  // Neither convention is safe to infer for a financial table row.
  if ((raw.qty.includes(",") && !raw.qty.includes(".")) ||
      [raw.unit_price, raw.total].some((value) => /,\d{3}$/.test(normalizeDigits(value)) && !value.includes("."))) return null;
  if (!/^\d{1,5}(?:[.,]\d{1,3})?$/.test(qtyText)) return null;
  const qty = Number(qtyText.replace(",", "."));
  const unit = parseMoneyMilli(raw.unit_price);
  const total = parseMoneyMilli(raw.total);
  const name = raw.name.trim();
  if (!qty || qty > 100_000 || unit === null || unit < 0 || total === null || total < 0 ||
      Math.abs(Math.round(qty * unit) - total) > 1 || name.length < 2 || name.length > 160 ||
      /(?:subtotal|grand\s*total|الإجمالي|المجموع|الضريبة|vat)/i.test(name)) return null;
  const normalized: Record<Column, string> = {
    name, qty: String(qty), unit_price: (unit / 1000).toFixed(3), total: (total / 1000).toFixed(3),
  };
  return Object.fromEntries((Object.keys(raw) as Column[]).map((column) => {
    const segment = assigned[column][0];
    const key = `line_item_${ordinal}_${column}`;
    return [key, {
      key, rawValue: raw[column], normalizedValue: normalized[column],
      confidence: Math.min(page.confidence, segment.confidence ?? page.confidence, 0.89),
      sourcePage: page.number, sourceBox: segment.box, method: page.method,
      validation: "valid", evidence: ["table_header", "table_row", "arithmetic"],
    } satisfies ExtractedField];
  }));
}

/** Extract only an entire, arithmetic-verified geometric table; never silently import a partial invoice. */
export function extractPurchaseLineItems(pages: DocumentPage[]): { fields: Record<string, ExtractedField>; issues: ExtractionIssue[] } {
  const all: Record<string, ExtractedField> = {};
  let count = 0;
  let incomplete = false;
  let foundHeader = false;
  for (const page of pages) {
    const grouped = rows(page.segments || []);
    let header: Record<Column, Positioned> | null = null;
    for (const row of grouped) {
      const candidate = headerColumns(row);
      if (Object.keys(candidate).length === 4) { header = candidate as Record<Column, Positioned>; foundHeader = true; continue; }
      if (!header) continue;
      if (row.some((segment) => /(?:grand\s*total|subtotal|vat|الإجمالي|المجموع|الضريبة)/i.test(segment.text))) {
        header = null;
        continue;
      }
      if (row.length < 2) continue;
      if (++count > MAX_ROWS) { incomplete = true; break; }
      const parsed = itemFields(page, row, header, count);
      if (!parsed) incomplete = true;
      else Object.assign(all, parsed);
    }
    if (incomplete) break;
  }
  if (incomplete || !foundHeader || !count) return {
    fields: {}, issues: [{ code: incomplete ? "LINE_ITEMS_UNRELIABLE" : "LINE_ITEMS_NOT_DETECTED", severity: "warning",
      message: "Purchase lines require manual entry; no partial or unverified table was applied." }],
  };
  return { fields: all, issues: [] };
}

export interface ReviewedPurchaseLine { name: string; qty: number; unitPrice: number; lineTotal: number }

/** Validate the explicit review selection again before handing anything to the purchase form. */
export function reviewedPurchaseLineItems(values: Record<string, string | null>): { items: ReviewedPurchaseLine[]; valid: boolean } {
  const ordinals = [...new Set(Object.keys(values).map((key) => key.match(ITEM_KEY)?.[1]).filter(Boolean))].map(Number).sort((a, b) => a - b);
  const items: ReviewedPurchaseLine[] = [];
  for (const ordinal of ordinals) {
    const keys = ["name", "qty", "unit_price", "total"].map((suffix) => `line_item_${ordinal}_${suffix}`);
    const chosen = keys.filter((key) => values[key] != null);
    if (!chosen.length) continue;
    if (chosen.length !== 4) return { items: [], valid: false };
    const [name, rawQty, rawUnit, rawTotal] = keys.map((key) => values[key]!.trim());
    if ((rawQty.includes(",") && !rawQty.includes(".")) ||
        [rawUnit, rawTotal].some((value) => /,\d{3}$/.test(normalizeDigits(value)) && !value.includes("."))) {
      return { items: [], valid: false };
    }
    const qty = Number(normalizeDigits(rawQty));
    const unit = parseMoneyMilli(rawUnit), total = parseMoneyMilli(rawTotal);
    if (name.length < 2 || name.length > 160 || !Number.isFinite(qty) || qty <= 0 || qty > 100_000 ||
        unit === null || unit < 0 || total === null || total < 0 || Math.abs(Math.round(qty * unit) - total) > 1) {
      return { items: [], valid: false };
    }
    items.push({ name, qty, unitPrice: unit / 1000, lineTotal: total / 1000 });
  }
  return { items, valid: true };
}
