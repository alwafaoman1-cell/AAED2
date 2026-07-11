import type { CompanyTaxProfile, ReadinessStatus, ServiceProviderSettings } from "./omanEInvoiceTypes";

export interface ReadinessCheck {
  key: string;
  label: string;
  status: ReadinessStatus;
  currentSupport: string;
  missing: string;
  recommendation: string;
}

function has(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : !!value;
}

export function buildEInvoicingReadinessChecks(input: {
  company: CompanyTaxProfile;
  serviceProvider: ServiceProviderSettings;
  hasInvoices: boolean;
  hasQr: boolean;
  hasAudit: boolean;
  hasExports: boolean;
  hasSnapshots: boolean;
  hasCreditNotes: boolean;
}): ReadinessCheck[] {
  const c = input.company;
  const companyFields = [
    c.legalNameAr || c.legalNameEn,
    c.commercialRegistration,
    c.vatRegistrationNumber,
    c.address,
    c.city,
    c.country,
  ];
  const companyReady = companyFields.every(has);
  return [
    {
      key: "company_tax_profile",
      label: "Company Tax Profile",
      status: companyReady ? "Ready" : "Partially Ready",
      currentSupport: "Company legal/tax profile is stored in tenant settings.",
      missing: companyReady ? "Accountant verification." : "Legal name, CR, VAT number, or address fields are incomplete.",
      recommendation: "Verify seller legal data with accountant before official rollout.",
    },
    {
      key: "invoice_sequence",
      label: "Invoice sequence",
      status: input.hasInvoices ? "Needs Accountant Verification" : "Partially Ready",
      currentSupport: "Sales and insurance invoices have separate numbers.",
      missing: "Formal sequence policy and cancellation gap policy need approval.",
      recommendation: "Lock final numbering rules before official e-invoicing.",
    },
    {
      key: "vat",
      label: "VAT 5%",
      status: Number(c.vatRate) === 5 ? "Ready" : "Needs Accountant Verification",
      currentSupport: "VAT-exclusive calculation is used internally.",
      missing: Number(c.vatRate) === 5 ? "Accountant review only." : "VAT rate must be reviewed.",
      recommendation: "Keep OMR 3 decimals and review VAT treatment with accountant.",
    },
    {
      key: "qr",
      label: "QR",
      status: input.hasQr ? "Partially Ready" : "Not Ready",
      currentSupport: "Customer Portal QR is supported.",
      missing: "Tax QR payload is pending official Oman specification/provider confirmation.",
      recommendation: "Do not mix portal QR with official tax QR until specification is confirmed.",
    },
    {
      key: "audit",
      label: "Audit Trail",
      status: input.hasAudit ? "Partially Ready" : "Not Ready",
      currentSupport: "Audit logs exist for operational actions.",
      missing: "Strict financial audit for invoice issue/cancel/credit note must be verified.",
      recommendation: "Record all financial events before official rollout.",
    },
    {
      key: "pdf_archive",
      label: "PDF archive / snapshot",
      status: input.hasSnapshots ? "Partially Ready" : "Not Ready",
      currentSupport: "Snapshot fields are prepared.",
      missing: "Immutable PDF archive is not fully enforced.",
      recommendation: "Store immutable JSON/PDF snapshots on invoice issue.",
    },
    {
      key: "credit_note",
      label: "Credit Note / Cancellation",
      status: input.hasCreditNotes ? "Partially Ready" : "Not Ready",
      currentSupport: "Credit note area exists as accounting foundation.",
      missing: "Official credit note flow and VAT reversal needs final validation.",
      recommendation: "Complete credit note workflow before official submission.",
    },
    {
      key: "exports",
      label: "Export",
      status: input.hasExports ? "Partially Ready" : "Not Ready",
      currentSupport: "PDF/Excel/JSON readiness exports are planned from reports.",
      missing: "Official schema/export format must be confirmed.",
      recommendation: "Keep exports as internal readiness until authority/provider confirms format.",
    },
    {
      key: "service_provider",
      label: "Service provider",
      status: input.serviceProvider.status === "connected" ? "Needs Tax Authority Verification" : "Not Ready",
      currentSupport: "Placeholder configuration is available.",
      missing: "No official provider/API integration is active.",
      recommendation: "Connect only through approved provider or official Tax Authority channel.",
    },
  ];
}

