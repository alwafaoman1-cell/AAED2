// ZATCA-style TLV QR (Phase-1) — يُستخدم كذلك لفواتير عمان كرمز معلومات سريع.
// خمس حقول: اسم البائع، الرقم الضريبي، التاريخ ISO، إجمالي الفاتورة، قيمة الضريبة.
import QRCode from "qrcode";

function tlv(tag: number, value: string): Uint8Array {
  const enc = new TextEncoder().encode(value);
  const bytes = new Uint8Array(2 + enc.length);
  bytes[0] = tag;
  bytes[1] = enc.length;
  bytes.set(enc, 2);
  return bytes;
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export interface ZatcaQrPayload {
  sellerName: string;
  vatNumber: string;
  timestamp: string; // ISO string
  total: number;     // including VAT
  vat: number;       // VAT amount
}

export function buildZatcaTlvBase64(p: ZatcaQrPayload): string {
  const parts = [
    tlv(1, p.sellerName || "—"),
    tlv(2, p.vatNumber || "—"),
    tlv(3, p.timestamp),
    tlv(4, p.total.toFixed(2)),
    tlv(5, p.vat.toFixed(2)),
  ];
  return toBase64(concat(parts));
}

/** يولّد Data-URL لصورة QR مع ترميز TLV (يصلح للتضمين داخل HTML/PDF). */
export async function buildZatcaQrDataUrl(p: ZatcaQrPayload): Promise<string> {
  const payload = buildZatcaTlvBase64(p);
  return await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 180,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}
