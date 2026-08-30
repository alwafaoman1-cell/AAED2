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
  vehicle360: {
    all: ["vehicle_360"] as const,
    detail: (tenantId?: string | null, vehicleId?: string | null) =>
      ["vehicle_360", tenantId ?? "", vehicleId ?? ""] as const,
  },
  vehicleEntries: {
    all: ["vehicle_entries"] as const,
    list: (filters?: unknown) => ["vehicle_entries", "list", filters ?? ""] as const,
    detail: (id?: string | null) => ["vehicle_entries", "detail", id ?? ""] as const,
    byClaim: (claimId?: string | null) => ["vehicle_entries", "claim", claimId ?? ""] as const,
    media: (id?: string | null) => ["vehicle_entries", "media", id ?? ""] as const,
  },
  vehicleHandovers: {
    all: ["vehicle_handover_records"] as const,
    byWorkOrder: (workOrderId?: string | null) => ["vehicle_handover_records", "work_order", workOrderId ?? ""] as const,
    byClaim: (claimId?: string | null) => ["vehicle_handover_records", "claim", claimId ?? ""] as const,
    byVehicle: (vehicleId?: string | null) => ["vehicle_handover_records", "vehicle", vehicleId ?? ""] as const,
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
  workOrderFinancials: {
    all: ["work_order_financials"] as const,
    detail: (tenantId?: string | null, workOrderId?: string | null, claimId?: string | null) =>
      ["work_order_financials", tenantId ?? "", workOrderId ?? "", claimId ?? ""] as const,
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
    all: ["reports"] as const,
    cloud: (filters?: unknown) => ["reports", "cloud", filters ?? ""] as const,
    vehiclesOverStayAll: ["reports", "vehicles_over_stay"] as const,
    vehiclesOverStay: (age?: number | string) => ["reports", "vehicles_over_stay", age ?? "all"] as const,
  },
  monthlyVehicleProfitability: {
    all: ["monthly-vehicle-profitability"] as const,
    report: (tenantId?: string | null, filters?: unknown) =>
      ["monthly-vehicle-profitability", tenantId ?? "", filters ?? ""] as const,
  },
  expenseManagement: {
    all: ["expense_management"] as const,
    list: (filters?: unknown) => ["expense_management", "list", filters ?? ""] as const,
    detail: (id?: string | null) => ["expense_management", "detail", id ?? ""] as const,
    categories: (filters?: unknown) => ["expense_management", "categories", filters ?? ""] as const,
    category: (id?: string | null) => ["expense_management", "category", id ?? ""] as const,
    categoryAudit: (id?: string | null) => ["expense_management", "category_audit", id ?? ""] as const,
    workOrders: (search?: string) => ["expense_management", "work_orders", search ?? ""] as const,
    suppliers: (search?: string) => ["expense_management", "suppliers", search ?? ""] as const,
    costCenters: ["expense_management", "cost_centers"] as const,
  },
  suppliers: {
    all: ["suppliers"] as const,
    list: (filters?: unknown) => ["suppliers", "list", filters ?? ""] as const,
    summary: (tenantId?: string | null) => ["suppliers", "summary", tenantId ?? ""] as const,
    detail: (supplierId?: string | null, filters?: unknown) => ["suppliers", "detail", supplierId ?? "", filters ?? ""] as const,
  },
  reportCenter: {
    all: ["report_center"] as const,
    catalog: ["report_center", "catalog"] as const,
    summary: (filters: unknown) => ["report_center", "summary", filters] as const,
    detail: (reportKey: string, filters: unknown) => ["report_center", "detail", reportKey, filters] as const,
    aggregates: (reportKey: string, filters: unknown) => ["report_center", "aggregates", reportKey, filters] as const,
    savedViews: (tenantId?: string | null) => ["report_center", "saved_views", tenantId ?? ""] as const,
    export: (reportKey: string, filters: unknown) => ["report_center", "export", reportKey, filters] as const,
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
