import type { VehicleDeliveryReceiptData } from "@/lib/pdfGenerator";
import type { WorkOrder } from "@/lib/workOrdersStore";

export interface VehicleDeliveryReceiptDraft {
  date?: string | null;
  receiverName?: string | null;
  receiverIdNumber?: string | null;
  customerIdNumber?: string | null;
  mileageOut?: string | null;
  workSummary?: string | null;
  partsReplaced?: string | null;
  warrantyNotes?: string | null;
  satisfactionNotes?: string | null;
  signatureDataUrl?: string | null;
  idPhotoDataUrl?: string | null;
}

export function formatDeliveryReceiptNumber(orderDisplay?: string): string {
  const source = String(orderDisplay || "").trim();
  const woMatch = source.match(/(?:WO|W)-\d{2,4}-(\d{1,6})$/i);
  const trailingMatch = source.match(/(?:^|[-/])(\d{1,6})$/);
  const raw = woMatch?.[1] || trailingMatch?.[1] || "";
  const sequence = raw ? Number(raw) : 1;
  return `DR-${String(Number.isFinite(sequence) && sequence > 0 ? sequence : 1).padStart(5, "0")}`;
}

export function getDefaultDeliveryWarrantyNotes(): string {
  return "ضمان لمدة 7 أيام أو 500 كم على الأعمال المنفذة فقط — لا يشمل الأعطال غير المرتبطة بالإصلاح.";
}

export function getDeliveredDateInputValue(value?: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10) || new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

export function buildDeliveryReceiptData(order: WorkOrder, draft: VehicleDeliveryReceiptDraft = {}): VehicleDeliveryReceiptData {
  const orderDisplay = order.displayNumber || order.id;
  return {
    receiptNumber: formatDeliveryReceiptNumber(orderDisplay),
    date: getDeliveredDateInputValue(draft.date),
    workOrderNumber: orderDisplay,
    customerName: order.customer || "—",
    customerPhone: order.phone || undefined,
    customerIdNumber: draft.customerIdNumber || undefined,
    receiverName: draft.receiverName || undefined,
    receiverIdNumber: draft.receiverIdNumber || undefined,
    vehicleType: order.vehicleType || "—",
    model: order.model || undefined,
    year: order.year || undefined,
    plateNumber: order.plate || "—",
    vin: order.vin || undefined,
    color: order.color || undefined,
    mileageOut: draft.mileageOut || order.mileage || undefined,
    workSummary: draft.workSummary || order.diagnosis || order.description || undefined,
    partsReplaced: draft.partsReplaced || buildPartsReplacedText(order),
    warrantyNotes: draft.warrantyNotes || getDefaultDeliveryWarrantyNotes(),
    satisfactionNotes: draft.satisfactionNotes || undefined,
    signatureDataUrl: draft.signatureDataUrl || undefined,
    idPhotoDataUrl: draft.idPhotoDataUrl || undefined,
  };
}

export function buildPartsReplacedText(order: WorkOrder): string | undefined {
  const lines = (order.partsNeeded || [])
    .filter((part) => part.fulfilled !== false)
    .map((part) => `• ${part.name}${part.quantity > 1 ? ` ×${part.quantity}` : ""}`);
  return lines.length ? lines.join("\n") : undefined;
}
