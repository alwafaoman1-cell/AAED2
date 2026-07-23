export const queryKeys = {
  auth: {
    profile: (userId?: string | null) => ["auth", "profile", userId ?? ""] as const,
  },
  dashboard: {
    summary: (tenantId?: string | null) => ["dashboard", "summary", tenantId ?? ""] as const,
  },
  settings: {
    vehicleStayAlerts: ["settings", "vehicle_stay_alerts"] as const,
  },
  insuranceClaims: {
    all: ["insurance_claims"] as const,
    list: (filters?: unknown) => ["insurance_claims", "list", filters ?? ""] as const,
    detail: (id?: string | null) => ["insurance_claims", id ?? ""] as const,
  },
  customers: {
    all: ["customers"] as const,
    list: (filters?: unknown) => ["customers", "list", filters ?? ""] as const,
    detail: (id?: string | null) => ["customers", "detail", id ?? ""] as const,
  },
  vehicles: {
    all: ["vehicles"] as const,
    list: (filters?: unknown) => ["vehicles", "list", filters ?? ""] as const,
    detail: (id?: string | null) => ["vehicles", "detail", id ?? ""] as const,
    byCustomer: (customerId?: string | null) => ["vehicles", customerId ?? ""] as const,
    media: (ids?: readonly string[]) => ["vehicles", "media", ids?.join(",") ?? ""] as const,
  },
  vehicleMedia: {
    avatar: (vehicleId?: string | null) => ["vehicle_media", "avatar", vehicleId ?? ""] as const,
    claim: (claimId?: string | null, workOrderId?: string | null, vehicleId?: string | null) =>
      ["vehicle_media", "claim", claimId ?? "", workOrderId ?? "", vehicleId ?? ""] as const,
    claimAll: ["vehicle_media", "claim"] as const,
  },
  jobOrders: {
    all: ["job_orders"] as const,
    list: (filters?: unknown) => ["job_orders", "list", filters ?? ""] as const,
    detail: (id?: string | null) => ["job_orders", "detail", id ?? ""] as const,
    inline: (workOrderId?: string | null) => ["job_order_inline", workOrderId ?? ""] as const,
  },
  insuranceCompanies: {
    all: ["insurance_companies"] as const,
    detail: (id?: string | null) => ["insurance_companies", id ?? ""] as const,
  },
  insuranceInvoices: {
    all: ["insurance_invoices"] as const,
  },
  insuranceAccounting: (filters?: unknown) => ["insurance_accounting", filters ?? ""] as const,
  reports: {
    cloud: (filters?: unknown) => ["reports", "cloud", filters ?? ""] as const,
    vehiclesOverStayAll: ["reports", "vehicles_over_stay"] as const,
    vehiclesOverStay: (age?: number | string) => ["reports", "vehicles_over_stay", age ?? "all"] as const,
  },
  insuranceEstimates: {
    all: ["insurance_estimates"] as const,
  },
  claimDocuments: (claimId?: string | null) => ["claim_documents", claimId ?? ""] as const,
  claimTimeline: (claimId?: string | null) => ["claim_timeline", claimId ?? ""] as const,
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
  estimates: {
    all: ["estimates"] as const,
    list: (filters?: unknown) => ["estimates", "list", filters ?? ""] as const,
    detail: (id?: string | null) => ["estimates", "detail", id ?? ""] as const,
    lookups: ["estimates", "lookups"] as const,
  },
  dailyTasks: {
    all: ["daily_tasks"] as const,
    list: (filter?: { date?: string | null; status?: string | null }) =>
      ["daily_tasks", "list", filter?.date ?? "all", filter?.status ?? "all"] as const,
  },
  insuranceEmployees: {
    all: ["insurance_company_employees"] as const,
    list: (companyId?: string | null, includeInactive?: boolean) =>
      ["insurance_company_employees", "list", companyId ?? "all", includeInactive ? "with_inactive" : "active"] as const,
    byIds: (ids?: readonly string[]) => ["insurance_company_employees", "by_ids", ids?.join(",") ?? ""] as const,
  },
  vehicleCatalog: {
    makes: ["vehicle_catalog", "makes"] as const,
    models: (makeId?: string | null) => ["vehicle_catalog", "models", makeId ?? ""] as const,
  },
  claimArchive: (id?: string | null) => ["claim_archive", id ?? ""] as const,
  claimAuditHeader: (id?: string | null) => ["claim_audit_header", id ?? ""] as const,
  claimAuditFull: (id?: string | null) => ["claim_audit_logs_full", id ?? ""] as const,
  insuranceDocumentsArchive: ["insurance_documents_archive"] as const,
  claimLinkedWorkOrder: (id?: string | null) => ["claim_linked_work_order", id ?? ""] as const,
  claimOperation: (id?: string | null) => ["claim_work_order_operation", id ?? ""] as const,
  vehicleClaimAudit: (vehicleId?: string | null) => ["vehicle_claim_audit_logs", vehicleId ?? ""] as const,
  vehicleClaimVisits: (vehicleId?: string | null) => ["vehicle_claim_visits", vehicleId ?? ""] as const,
  vehiclePublicTracking: (vehicleId?: string | null) => ["vehicle_public_tracking_logs", vehicleId ?? ""] as const,
};
