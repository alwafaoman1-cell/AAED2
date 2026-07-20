export const queryKeys = {
  insuranceClaims: {
    all: ["insurance_claims"] as const,
    detail: (id?: string | null) => ["insurance_claims", id ?? ""] as const,
  },
  customers: {
    all: ["customers"] as const,
  },
  vehicles: {
    all: ["vehicles"] as const,
    byCustomer: (customerId?: string | null) => ["vehicles", customerId ?? ""] as const,
  },
  jobOrders: {
    all: ["job_orders"] as const,
    inline: (workOrderId?: string | null) => ["job_order_inline", workOrderId ?? ""] as const,
  },
  insuranceCompanies: {
    all: ["insurance_companies"] as const,
    detail: (id?: string | null) => ["insurance_companies", id ?? ""] as const,
  },
  insuranceInvoices: {
    all: ["insurance_invoices"] as const,
  },
  insuranceEstimates: {
    all: ["insurance_estimates"] as const,
  },
  claimDocuments: (claimId?: string | null) => ["claim_documents", claimId ?? ""] as const,
  claimAudit: (claimId?: string | null) => ["claim_audit_logs", claimId ?? ""] as const,
  claimPayments: {
    all: ["claim_payments"] as const,
    byClaim: (claimId?: string | null) => ["claim_payments", "by_claim", claimId ?? ""] as const,
    byCompany: (companyId?: string | null) => ["claim_payments", "by_company", companyId ?? ""] as const,
  },
  claimActiveInvoice: (claimId?: string | null) => ["claim_active_invoice", claimId ?? ""] as const,
  claimMedia: {
    all: ["claim_media"] as const,
    list: (claimId?: string | null) => ["claim_media", "list", claimId ?? ""] as const,
    detail: (mediaId?: string | null) => ["claim_media", "detail", mediaId ?? ""] as const,
  },
  unifiedRevenueInsuranceInvoices: ["unified_revenue_ins_invoices"] as const,
  claimEstimateNumber: (tenantId?: string | null, claimId?: string | null) =>
    ["claim-estimate-number", tenantId ?? "", claimId ?? ""] as const,
};
