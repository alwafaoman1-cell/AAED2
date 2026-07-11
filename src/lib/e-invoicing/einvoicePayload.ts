import { roundMoney } from "@/lib/money";
import type { CompanyTaxProfile, EInvoiceLine, InternalEInvoicePayload } from "./omanEInvoiceTypes";

export const DEFAULT_COMPANY_TAX_PROFILE: CompanyTaxProfile = {
  legalNameAr: "",
  legalNameEn: "",
  commercialRegistration: "",
  vatRegistrationNumber: "",
  taxpayerIdentification: "",
  address: "",
  city: "Muscat",
  country: "Oman",
  phone: "",
  email: "",
  defaultCurrency: "OMR",
  vatRate: 5,
  eInvoicingStatus: "not_configured",
};

export function makeEInvoiceLine(description: string, quantity: number, unitPrice: number, vatRate = 0.05): EInvoiceLine {
  const qty = Number(quantity) || 1;
  const price = roundMoney(unitPrice, 3);
  const subtotal = roundMoney(qty * price, 3);
  const vatAmount = roundMoney(subtotal * vatRate, 3);
  return {
    description: description || "Invoice item",
    quantity: qty,
    unitPrice: price,
    subtotal,
    vatRate,
    vatAmount,
    total: roundMoney(subtotal + vatAmount, 3),
  };
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildInternalEInvoicePayload(input: {
  seller: CompanyTaxProfile;
  buyer: Record<string, unknown>;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: InternalEInvoicePayload["invoiceType"];
  lineItems: EInvoiceLine[];
  paymentStatus?: string;
  workOrderReference?: string | null;
  claimReference?: string | null;
  vehicleReference?: string | null;
  portalQrUrl?: string | null;
  sourceSystemId?: string | null;
}): Promise<InternalEInvoicePayload> {
  const subtotalBeforeVat = roundMoney(input.lineItems.reduce((s, i) => s + i.subtotal, 0), 3);
  const vatAmount = roundMoney(input.lineItems.reduce((s, i) => s + i.vatAmount, 0), 3);
  const totalIncludingVat = roundMoney(subtotalBeforeVat + vatAmount, 3);
  const payloadBase = {
    payloadType: "Internal E-Invoice Payload" as const,
    officialTaxPayload: false as const,
    seller: input.seller,
    buyer: input.buyer,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    invoiceType: input.invoiceType,
    currency: "OMR" as const,
    lineItems: input.lineItems,
    subtotalBeforeVat,
    vatRate: Number(input.seller.vatRate || 5) / 100,
    vatAmount,
    totalIncludingVat,
    paymentStatus: input.paymentStatus,
    workOrderReference: input.workOrderReference,
    claimReference: input.claimReference,
    vehicleReference: input.vehicleReference,
    portalQrUrl: input.portalQrUrl,
    taxQrStatus: "pending_official_specification" as const,
    sourceSystemId: input.sourceSystemId,
    generatedAt: new Date().toISOString(),
  };
  const auditHash = await sha256Hex(JSON.stringify(payloadBase));
  return { ...payloadBase, auditHash };
}

