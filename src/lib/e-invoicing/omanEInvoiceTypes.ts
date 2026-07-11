export type ReadinessStatus =
  | "Ready"
  | "Partially Ready"
  | "Not Ready"
  | "Needs Accountant Verification"
  | "Needs Tax Authority Verification";

export interface CompanyTaxProfile {
  legalNameAr: string;
  legalNameEn: string;
  commercialRegistration: string;
  vatRegistrationNumber: string;
  taxpayerIdentification?: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  defaultCurrency: "OMR";
  vatRate: number;
  eInvoicingStatus:
    | "not_configured"
    | "ready_for_internal_review"
    | "pending_service_provider"
    | "connected_to_service_provider"
    | "officially_verified";
}

export interface ServiceProviderSettings {
  status: "not_connected" | "provider_required" | "pending_configuration" | "connected";
  providerName: string;
  environment: "sandbox" | "production";
  apiEndpoint: string;
  clientId: string;
  certificateStatus: "not_configured" | "pending" | "installed" | "expired";
}

export interface EInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

export interface InternalEInvoicePayload {
  payloadType: "Internal E-Invoice Payload";
  officialTaxPayload: false;
  seller: CompanyTaxProfile;
  buyer: Record<string, unknown>;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: "cash" | "insurance" | "credit_note" | "unknown";
  currency: "OMR";
  lineItems: EInvoiceLine[];
  subtotalBeforeVat: number;
  vatRate: number;
  vatAmount: number;
  totalIncludingVat: number;
  paymentStatus?: string;
  workOrderReference?: string | null;
  claimReference?: string | null;
  vehicleReference?: string | null;
  portalQrUrl?: string | null;
  taxQrStatus: "pending_official_specification";
  sourceSystemId?: string | null;
  auditHash?: string | null;
  generatedAt: string;
}

