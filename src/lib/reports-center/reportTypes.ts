export type ReportBusinessType = "all" | "insurance" | "cash";

export type ReportCategory =
  | "overview"
  | "insurance"
  | "cash"
  | "combined"
  | "operations"
  | "invoices"
  | "expenses"
  | "profitability"
  | "performance"
  | "saved";

export type ReportExportFormat = "screen" | "pdf" | "xlsx" | "print";

export type ReportPermission =
  | "admin"
  | "manager"
  | "accountant"
  | "insurance"
  | "supervisor";

export interface ReportText {
  ar: string;
  en: string;
}

export interface ReportColumnDefinition {
  key: string;
  label: ReportText;
  type: "text" | "date" | "money" | "number" | "percentage" | "status";
}

export interface ReportDefinition {
  key: string;
  title: ReportText;
  description: ReportText;
  category: ReportCategory;
  businessTypes: ReportBusinessType[];
  permissions: ReportPermission[];
  route: string;
  filters: string[];
  columns: ReportColumnDefinition[];
  sorting: string[];
  grouping: string[];
  totals: string[];
  exportFormats: ReportExportFormat[];
  calculationNotes: ReportText[];
  legacyRoutes?: string[];
  implementation: "ready" | "legacy" | "planned";
}

export interface ReportCenterFilters {
  tenantId: string;
  reportKey: string;
  businessType: ReportBusinessType;
  from: string;
  to: string;
  search: string;
  category: ReportCategory | "all";
  insuranceCompanyId: string;
  customerId: string;
  vehicleId: string;
  plate: string;
  vin: string;
  claimNumber: string;
  workOrderNumber: string;
  invoiceNumber: string;
  claimStatus: string;
  workOrderStatus: string;
  vehicleStatus: string;
  invoiceStatus: string;
  collectionStatus: string;
  employeeId: string;
  surveyorId: string;
  insuranceEmployeeId: string;
  supplierId: string;
  expenseCategory: string;
  paymentMethod: string;
  workshopLocation: string;
  department: string;
  page: number;
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
  groupBy: string;
}

export interface ReportCenterSummary {
  claimsCount: number;
  workOrdersCount: number;
  vehiclesInWorkshop: number;
  deliveredVehicles: number;
  estimateTotal: number;
  approvedTotal: number;
  invoiceSubtotal: number;
  vat: number;
  invoiceTotal: number;
  paid: number;
  outstanding: number;
  expenses: number;
  partsCost: number;
  laborCost: number;
  transportCost: number;
  grossProfit: number;
  grossMargin: number;
  averageWorkshopDays: number;
  overdueInvoices: number;
  claimsAwaitingCollection: number;
  completedWithoutInvoice: number;
}

export interface ReportCenterSummaryResult {
  available: boolean;
  summary: ReportCenterSummary | null;
  generatedAt: string | null;
  reason?: string;
}

export type ReportRow = Record<string, unknown>;

export interface ReportPagination {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface ReportDataResult {
  available: boolean;
  rows: ReportRow[];
  pagination: ReportPagination;
  aggregates: Record<string, number>;
  dataQuality: {
    unknownBusinessType: number;
  };
  generatedAt: string | null;
  reason?: string;
}
