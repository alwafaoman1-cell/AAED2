import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { FeatureProvider } from "@/contexts/FeatureContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ThemeProvider } from "@/contexts/ThemeContext";
import AppLayout from "./components/AppLayout";
// Eager: critical paths (auth + landing dashboard) for fast first paint
import AuthPage from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import ReportsLegacyRedirect from "./components/reports/ReportsLegacyRedirect";

import HomeShortcuts from "./pages/HomeShortcuts";

// Role-based home redirector: supervisors land on their mobile app, others see the shortcuts home.
function RoleHome() {
  const { profile } = useAuth();
  if (profile?.role === "supervisor") return <Navigate to="/supervisor" replace />;
  return <HomeShortcuts />;
}

function LegacyPortalRedirect({ param = "token" }: { param?: "id" | "token" | "plate" }) {
  const params = useParams();
  const value = params[param] || params.token || params.id || params.plate || "";
  return <Navigate to={value ? `/p/${encodeURIComponent(value)}` : "/"} replace />;
}

// Lazy: every other route — splits the bundle and dramatically improves first-paint
const ResetPasswordPage = lazy(() => import("./pages/ResetPassword"));
const InvoicePublicView = lazy(() => import("./pages/InvoicePublicView"));
const Users = lazy(() => import("./pages/Users"));
const WorkOrders = lazy(() => import("./pages/WorkOrders"));
const WorkOrderNew = lazy(() => import("./pages/WorkOrderNew"));
const WorkOrderDetail = lazy(() => import("./pages/WorkOrderDetail"));
const Inspection = lazy(() => import("./pages/Inspection"));
const InspectionReportPage = lazy(() => import("./pages/InspectionReportPage"));
const InsuranceInspectionPage = lazy(() => import("./pages/InsuranceInspectionPage"));
const InvoicesManagement = lazy(() => import("./pages/sales/InvoicesManagement"));
const NewInvoice = lazy(() => import("./pages/sales/NewInvoice"));
const EditInvoice = lazy(() => import("./pages/sales/EditInvoice"));
const InvoiceDetail = lazy(() => import("./pages/sales/InvoiceDetail"));
const QuotesManagement = lazy(() => import("./pages/sales/QuotesManagement"));
const NewQuote = lazy(() => import("./pages/sales/NewQuote"));
const QuoteDetail = lazy(() => import("./pages/sales/QuoteDetail"));
const CreditNotes = lazy(() => import("./pages/sales/CreditNotes"));
const NewCreditNote = lazy(() => import("./pages/sales/CreditNoteForms").then(m => ({ default: m.NewCreditNote })));
const CreditNoteDetail = lazy(() => import("./pages/sales/CreditNoteForms").then(m => ({ default: m.CreditNoteDetail })));
const ReturnedInvoices = lazy(() => import("./pages/sales/Returns").then(m => ({ default: m.ReturnedInvoices })));
const NewReturn = lazy(() => import("./pages/sales/Returns").then(m => ({ default: m.NewReturn })));
const ReturnDetail = lazy(() => import("./pages/sales/Returns").then(m => ({ default: m.ReturnDetail })));
const RecurringInvoices = lazy(() => import("./pages/sales/Recurring").then(m => ({ default: m.RecurringInvoices })));
const NewRecurring = lazy(() => import("./pages/sales/Recurring").then(m => ({ default: m.NewRecurring })));
const RecurringDetail = lazy(() => import("./pages/sales/Recurring").then(m => ({ default: m.RecurringDetail })));
const CustomerPayments = lazy(() => import("./pages/sales/CustomerPayments"));
const SalesSettings = lazy(() => import("./pages/sales/SalesSettings"));
const Accounting = lazy(() => import("./pages/Accounting"));
const ExpensesManagementPage = lazy(() => import("./pages/accounting/expenses/ExpensesManagementPage"));
const ExpenseFormPage = lazy(() => import("./pages/accounting/expenses/ExpenseFormPage"));
const ExpenseCategoriesManagementPage = lazy(() => import("./pages/accounting/expenses/ExpenseCategoriesPage"));
const ExpenseCategoryFormPage = lazy(() => import("./pages/accounting/expenses/ExpenseCategoryFormPage"));
const Receipts = lazy(() => import("./pages/accounting/Receipts"));
const CashboxTopup = lazy(() => import("./pages/accounting/CashboxTopup"));
const Inventory = lazy(() => import("./pages/Inventory"));
const PurchaseInvoices = lazy(() => import("./pages/purchases/PurchaseInvoices"));
const Suppliers = lazy(() => import("./pages/purchases/Suppliers"));
const SupplierPayments = lazy(() => import("./pages/purchases/SupplierPayments"));
const PurchaseReturns = lazy(() => import("./pages/purchases/PurchaseReturns"));
const SupplierBalanceReport = lazy(() => import("./pages/purchases/SupplierBalanceReport"));
const StockMovements = lazy(() => import("./pages/inventory/StockMovements"));
const PartsCatalogImport = lazy(() => import("./pages/inventory/PartsCatalogImport"));
const InventoryDetail = lazy(() => import("./pages/inventory/InventoryDetail"));
const Staff = lazy(() => import("./pages/staff/EmployeesList"));
const EmployeeDetail = lazy(() => import("./pages/staff/EmployeeDetail"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const InsuranceHub = lazy(() => import("./pages/insurance/InsuranceHub"));
const InsuranceClaimsList = lazy(() => import("./pages/insurance/InsuranceClaimsList"));
const InsurancePipeline = lazy(() => import("./pages/insurance/InsurancePipeline"));
const InsuranceAlertsCenter = lazy(() => import("./pages/insurance/InsuranceAlertsCenter"));
const InsuranceClaimDetail = lazy(() => import("./pages/insurance/InsuranceClaimDetail"));
const InsuranceClaimAuditPage = lazy(() => import("./pages/insurance/InsuranceClaimAuditPage"));
const NewInsuranceClaim = lazy(() => import("./pages/insurance/NewInsuranceClaim"));
const InsuranceCompanies = lazy(() => import("./pages/insurance/InsuranceCompanies"));
const InsuranceCompanyDetail = lazy(() => import("./pages/insurance/InsuranceCompanyDetail"));
const InsurancePayments = lazy(() => import("./pages/insurance/InsurancePayments"));
const InvestorsReport = lazy(() => import("./pages/insurance/InvestorsReport"));
const InsuranceWorkOrders = lazy(() => import("./pages/insurance/InsuranceWorkOrders"));
const InsuranceAccounting = lazy(() => import("./pages/insurance/InsuranceAccounting"));
const InsuranceEstimates = lazy(() => import("./pages/insurance/InsuranceEstimates"));
const InsuranceIndependentEstimates = lazy(() => import("./pages/insurance/InsuranceIndependentEstimates"));
const InsuranceDocumentsArchive = lazy(() => import("./pages/insurance/InsuranceDocumentsArchive"));
const InsuranceImport = lazy(() => import("./pages/insurance/InsuranceImport"));
const ClaimArchivePage = lazy(() => import("./pages/insurance/ClaimArchivePage"));
const InsuranceLayout = lazy(() => import("./components/insurance/InsuranceLayout"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const VehicleDetail = lazy(() => import("./pages/VehicleDetail"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));
const TrashPage = lazy(() => import("./pages/TrashPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const ReportsCenter = lazy(() => import("./pages/ReportsCenter"));
const LegacyReports = lazy(() => import("./pages/Reports"));
const ClassicReports = lazy(() => import("./pages/ReportsClassic"));
const EInvoicingSettingsPage = lazy(() => import("./pages/settings/EInvoicingSettingsPage"));
const EstimatesList = lazy(() => import("./pages/estimates/EstimatesList"));
const EstimateForm = lazy(() => import("./pages/estimates/EstimateForm"));
const EstimateDetail = lazy(() => import("./pages/estimates/EstimateDetail"));
const VehicleEntryList = lazy(() => import("./pages/vehicle-entry/VehicleEntryList"));
const VehicleEntryForm = lazy(() => import("./pages/vehicle-entry/VehicleEntryForm"));
const VehicleEntryDetail = lazy(() => import("./pages/vehicle-entry/VehicleEntryDetail"));
const ExecutiveDashboard = lazy(() => import("./pages/dashboard/ExecutiveDashboard"));
const PrintTemplates = lazy(() => import("./pages/settings/PrintTemplates"));
const PrintTemplateVariants = lazy(() => import("./pages/settings/PrintTemplateVariants"));
const PrintTemplateEditor = lazy(() => import("./pages/settings/PrintTemplateEditor"));
const RolesPermissionsPage = lazy(() => import("./pages/settings/RolesPermissionsPage"));
const VehiclesCleanupPage = lazy(() => import("./pages/settings/VehiclesCleanup"));
const QuickActionsSettingsPage = lazy(() => import("./pages/settings/QuickActionsSettingsPage"));
const ModulesSettingsPage = lazy(() => import("./pages/settings/ModulesSettingsPage"));
const DataMigrationPage = lazy(() => import("./pages/settings/DataMigrationPage"));
const PublicAccessSettingsPage = lazy(() => import("./pages/settings/PublicAccessSettingsPage"));
const SmsSettingsPage = lazy(() => import("./pages/settings/SmsSettingsPage"));
const TaxSettingsPage = lazy(() => import("./pages/settings/TaxSettingsPage"));
const IntegrationsSettingsPage = lazy(() => import("./pages/settings/IntegrationsSettingsPage"));
const SecurityDangerZone = lazy(() => import("./components/settings/SecurityDangerZone"));
const PaymentGatewaysPage = lazy(() => import("./pages/settings/PaymentGatewaysPage"));
const BackupRestorePage = lazy(() => import("./pages/settings/BackupRestorePage"));
const AiKeysSettingsPage = lazy(() => import("./pages/settings/AiKeysSettingsPage"));
const PdfLayoutPage = lazy(() => import("./pages/settings/PdfLayoutPage"));
const PdfQaPage = lazy(() => import("./pages/settings/PdfQaPage"));
const PdfV2PreviewPage = lazy(() => import("./pages/PdfV2PreviewPage"));
const NumberingSettingsPage = lazy(() => import("./pages/settings/NumberingSettingsPage"));
const DailyTasks = lazy(() => import("./pages/DailyTasks"));
const DailyLog = lazy(() => import("./pages/DailyLog"));
const ExpensesImport = lazy(() => import("./pages/ExpensesImport"));
const MediaStudio = lazy(() => import("./pages/MediaStudio"));
const ImportExportCenter = lazy(() => import("./pages/ImportExportCenter"));
const TechnicianApp = lazy(() => import("./pages/tech/TechnicianApp"));
const TechQrScanPage = lazy(() => import("./pages/tech/TechQrScanPage"));
const ManagerApp = lazy(() => import("./pages/apps/ManagerApp"));
const AccountantApp = lazy(() => import("./pages/apps/AccountantApp"));
const SupervisorApp = lazy(() => import("./pages/apps/SupervisorApp"));
const InstallAppPage = lazy(() => import("./pages/InstallAppPage"));
const AppsHub = lazy(() => import("./pages/AppsHub"));
const SupplementApprovalPage = lazy(() => import("./pages/public/SupplementApprovalPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/public/PrivacyPolicyPage"));
const VehicleBelongingsSettingsPage = lazy(() => import("./pages/settings/VehicleBelongingsSettingsPage"));
const MessagesCenter = lazy(() => import("./pages/MessagesCenter"));
const CustomerNotificationsSettingsPage = lazy(() => import("./pages/settings/CustomerNotificationsSettingsPage"));
const VehicleStayAlertsSettingsPage = lazy(() => import("./pages/settings/VehicleStayAlertsSettingsPage"));
const AdminNotifications = lazy(() => import("./pages/AdminNotifications"));
const SaasAdminConsole = lazy(() => import("./pages/admin/SaasAdminConsole"));
const TenantFiles = lazy(() => import("./pages/admin/TenantFiles"));
const WorkOrderSignPage = lazy(() => import("./pages/public/WorkOrderSignPage"));
const accountingSetupPage = <K extends keyof typeof import("./pages/accounting/setup/AccountingSetupPages")>(name: K) =>
  lazy(() => import("./pages/accounting/setup/AccountingSetupPages").then((module) => ({ default: module[name] as ComponentType })));
const AccountingSetupCenterPage = accountingSetupPage("AccountingSetupCenterPage");
const AccountsPage = accountingSetupPage("AccountsPage");
const AccountFormPage = accountingSetupPage("AccountFormPage");
const AccountTemplatePage = lazy(() => import("./pages/accounting/setup/AccountTemplatePage"));
const FiscalYearsPage = accountingSetupPage("FiscalYearsPage");
const FiscalYearFormPage = accountingSetupPage("FiscalYearFormPage");
const PeriodsPage = accountingSetupPage("PeriodsPage");
const PeriodFormPage = accountingSetupPage("PeriodFormPage");
const CostCentersPage = accountingSetupPage("CostCentersPage");
const CostCenterFormPage = accountingSetupPage("CostCenterFormPage");
const MappingsPage = accountingSetupPage("MappingsPage");
const MappingFormPage = accountingSetupPage("MappingFormPage");
const PostingRulesPage = accountingSetupPage("PostingRulesPage");
const PostingRuleFormPage = accountingSetupPage("PostingRuleFormPage");
const CashBankAccountsPage = accountingSetupPage("CashBankAccountsPage");
const OpeningBalancesPage = accountingSetupPage("OpeningBalancesPage");
const OpeningBalanceNewPage = accountingSetupPage("OpeningBalanceNewPage");
const OpeningBalanceDetailPage = accountingSetupPage("OpeningBalanceDetailPage");
const AccountingReadinessPage = accountingSetupPage("AccountingReadinessPage");
const accountingReportsPage = <K extends keyof typeof import("./pages/accounting/reports/AccountingReportsPages")>(name: K) =>
  lazy(() => import("./pages/accounting/reports/AccountingReportsPages").then((module) => ({ default: module[name] as ComponentType })));
const AccountingReportsCenterPage = accountingReportsPage("AccountingReportsCenterPage");
const AccountingReportPage = accountingReportsPage("AccountingReportPage") as LazyExoticComponent<ComponentType<{ reportKey: import("@/lib/accounting/accountingReports").AccountingReportKey }>>;
const JournalEntryDetailPage = accountingReportsPage("JournalEntryDetailPage");
const GeneralLedgerAccountPage = accountingReportsPage("GeneralLedgerAccountPage");
const VehicleProfitLossDetailPage = accountingReportsPage("VehicleProfitLossDetailPage");
const MonthlyVehicleProfitabilityPage = lazy(() => import("./pages/accounting/reports/MonthlyVehicleProfitabilityPage"));

import { setTemplateQueryClient } from "@/lib/printTemplates/resolver";
import { useAutoTranslate } from "@/i18n/autoTranslate";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import SystemPreferencesBoot from "@/components/SystemPreferencesBoot";
import UnsavedWorkGuard from "@/components/UnsavedWorkGuard";
import AccountingSetupRouteGuard from "@/components/accounting/AccountingSetupRouteGuard";
import AccountingReportsRouteGuard from "@/components/accounting/AccountingReportsRouteGuard";

// كاش حيّ — يعيد الجلب فور الدخول للصفحة لمنع عرض بيانات قديمة بين التنقّلات.
// المستخدم كان يضطر لـ Ctrl+Shift+R لأن staleTime كان 30s.
const shouldRetryQuery = (failureCount: number, error: unknown) => {
  if (failureCount >= 2) return false;
  const status = Number((error as { status?: number })?.status || (error as { code?: number })?.code || 0);
  const message = String((error as { message?: string })?.message || "");
  if ([400, 401, 403, 404, 409].includes(status)) return false;
  if (/row-level security|permission denied|schema cache|column .* does not exist|not found/i.test(message)) return false;
  return true;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60_000,
      gcTime: 20 * 60_000,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: shouldRetryQuery,
    },
    mutations: { retry: 0 },
  },
});
setTemplateQueryClient(queryClient);

// Do not let browser focus/visibility events trigger implicit app refreshes.
// Explicit saves and scoped realtime events remain the only refresh paths.
focusManager.setEventListener(() => () => {});

const AutoTranslateBoot = () => {
  useAutoTranslate();
  return null;
};

const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground text-sm">
    <div className="animate-pulse">جارٍ التحميل…</div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <FeatureProvider>
          <AutoTranslateBoot />
          <SystemPreferencesBoot />
          <UnsavedWorkGuard />
          <KeyboardShortcuts />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/install" element={<InstallAppPage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
            <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
            <Route path="/track/:id" element={<LegacyPortalRedirect param="id" />} />
            <Route path="/invoice/view/:token" element={<InvoicePublicView />} />
            <Route path="/p/:token" element={<CustomerPortal />} />
            <Route path="/v/:plate" element={<LegacyPortalRedirect param="plate" />} />
            <Route path="/c/approve/:token" element={<SupplementApprovalPage />} />
            <Route path="/sign/:token" element={<WorkOrderSignPage />} />
            <Route path="/pdf/:documentType/:id" element={<ProtectedRoute><PdfV2PreviewPage /></ProtectedRoute>} />
            <Route path="/pdf-preview/:documentType/:id" element={<ProtectedRoute><PdfV2PreviewPage /></ProtectedRoute>} />
            <Route path="/technician" element={<ProtectedRoute roles={["admin","manager","technician"]}><TechnicianApp /></ProtectedRoute>} />
            <Route path="/technician/scan" element={<ProtectedRoute roles={["admin","manager","technician"]}><TechQrScanPage /></ProtectedRoute>} />
            <Route path="/tech" element={<Navigate to="/technician" replace />} />
            <Route path="/tech/scan" element={<Navigate to="/technician/scan" replace />} />
            <Route path="/manager-app" element={<ProtectedRoute roles={["admin","manager"]}><ManagerApp /></ProtectedRoute>} />
            <Route path="/accountant" element={<ProtectedRoute roles={["admin","manager","accountant"]}><AccountantApp /></ProtectedRoute>} />
            <Route path="/accountant-app" element={<Navigate to="/accountant" replace />} />
            <Route path="/supervisor" element={<ProtectedRoute roles={["admin","manager","supervisor"]}><SupervisorApp /></ProtectedRoute>} />
            <Route path="/supervisor-app" element={<Navigate to="/supervisor" replace />} />

            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<RoleHome />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/apps" element={<AppsHub />} />
              <Route path="/work-orders" element={<WorkOrders />} />
              <Route path="/work-orders/new" element={<WorkOrderNew />} />
              <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
              <Route path="/inspection" element={<Inspection />} />
              <Route path="/inspection/insurance/new" element={<InsuranceInspectionPage />} />
              <Route path="/inspection/:id/report" element={<InspectionReportPage />} />
              <Route path="/sales" element={<Navigate to="/sales/invoices" replace />} />
              <Route path="/sales/invoices" element={<InvoicesManagement />} />
              <Route path="/sales/invoices/new" element={<NewInvoice />} />
              <Route path="/sales/invoices/:id" element={<InvoiceDetail />} />
              <Route path="/sales/invoices/:id/edit" element={<EditInvoice />} />
              <Route path="/sales/quotes" element={<QuotesManagement />} />
              <Route path="/sales/quotes/new" element={<NewQuote />} />
              <Route path="/sales/quotes/:id" element={<QuoteDetail />} />
              <Route path="/sales/quotes/:id/edit" element={<NewQuote />} />
              <Route path="/sales/credit-notes" element={<CreditNotes />} />
              <Route path="/sales/credit-notes/new" element={<NewCreditNote />} />
              <Route path="/sales/credit-notes/:id" element={<CreditNoteDetail />} />
              <Route path="/sales/credit-notes/:id/edit" element={<NewCreditNote />} />
              <Route path="/sales/returns" element={<ReturnedInvoices />} />
              <Route path="/sales/returns/new" element={<NewReturn />} />
              <Route path="/sales/returns/:id" element={<ReturnDetail />} />
              <Route path="/sales/returns/:id/edit" element={<NewReturn />} />
              <Route path="/sales/recurring" element={<RecurringInvoices />} />
              <Route path="/sales/recurring/new" element={<NewRecurring />} />
              <Route path="/sales/recurring/:id" element={<RecurringDetail />} />
              <Route path="/sales/recurring/:id/edit" element={<NewRecurring />} />
              <Route path="/sales/payments" element={<CustomerPayments />} />
              <Route path="/sales/settings" element={<SalesSettings />} />
              <Route path="/estimates" element={<EstimatesList />} />
              <Route path="/estimates/new" element={<EstimateForm />} />
              <Route path="/estimates/:id" element={<EstimateDetail />} />
              <Route path="/estimates/:id/edit" element={<EstimateForm />} />
              <Route path="/vehicle-entry" element={<VehicleEntryList />} />
              <Route path="/vehicle-entry/new" element={<VehicleEntryForm />} />
              <Route path="/vehicle-entry/:id" element={<VehicleEntryDetail />} />
              <Route path="/vehicle-entry/:id/edit" element={<VehicleEntryForm />} />
              <Route path="/accounting" element={<ProtectedRoute roles={["admin","manager","accountant"]}><Accounting /></ProtectedRoute>} />
              <Route path="/accounting/expenses" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpensesManagementPage /></ProtectedRoute>} />
              <Route path="/accounting/expenses/new" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpenseFormPage /></ProtectedRoute>} />
              <Route path="/accounting/expenses/:expenseId/edit" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpenseFormPage /></ProtectedRoute>} />
              <Route path="/accounting/expenses/categories" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpenseCategoriesManagementPage /></ProtectedRoute>} />
              <Route path="/accounting/expenses/categories/new" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpenseCategoryFormPage /></ProtectedRoute>} />
              <Route path="/accounting/expenses/categories/:categoryId" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpenseCategoryFormPage /></ProtectedRoute>} />
              <Route path="/accounting/receipts" element={<ProtectedRoute roles={["admin","manager","accountant"]}><Receipts /></ProtectedRoute>} />
              <Route path="/accounting/cashbox/topup" element={<ProtectedRoute roles={["admin","manager","accountant"]}><CashboxTopup /></ProtectedRoute>} />
              <Route path="/accounting/setup" element={<AccountingSetupRouteGuard permission="accounting.view_journal"><AccountingSetupCenterPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/accounts" element={<AccountingSetupRouteGuard permission="accounting.manage_accounts"><AccountsPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/accounts/new" element={<AccountingSetupRouteGuard permission="accounting.manage_accounts"><AccountFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/accounts/template" element={<AccountingSetupRouteGuard permission="accounting.manage_accounts"><AccountTemplatePage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/accounts/:accountId" element={<AccountingSetupRouteGuard permission="accounting.manage_accounts"><AccountFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/fiscal-years" element={<AccountingSetupRouteGuard permission="accounting.manage_fiscal_years"><FiscalYearsPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/fiscal-years/new" element={<AccountingSetupRouteGuard permission="accounting.manage_fiscal_years"><FiscalYearFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/fiscal-years/:fiscalYearId" element={<AccountingSetupRouteGuard permission="accounting.manage_fiscal_years"><FiscalYearFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/periods" element={<AccountingSetupRouteGuard permission="accounting.manage_periods"><PeriodsPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/periods/new" element={<AccountingSetupRouteGuard permission="accounting.manage_periods"><PeriodFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/periods/:periodId" element={<AccountingSetupRouteGuard permission="accounting.manage_periods"><PeriodFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/cost-centers" element={<AccountingSetupRouteGuard permission="accounting.manage_cost_centers"><CostCentersPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/cost-centers/new" element={<AccountingSetupRouteGuard permission="accounting.manage_cost_centers"><CostCenterFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/cost-centers/:costCenterId" element={<AccountingSetupRouteGuard permission="accounting.manage_cost_centers"><CostCenterFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/mappings" element={<AccountingSetupRouteGuard permission="accounting.manage_mappings"><MappingsPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/mappings/new" element={<AccountingSetupRouteGuard permission="accounting.manage_mappings"><MappingFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/mappings/:mappingId" element={<AccountingSetupRouteGuard permission="accounting.manage_mappings"><MappingFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/posting-rules" element={<AccountingSetupRouteGuard permission="accounting.manage_mappings"><PostingRulesPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/posting-rules/new" element={<AccountingSetupRouteGuard permission="accounting.manage_mappings"><PostingRuleFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/posting-rules/:ruleId" element={<AccountingSetupRouteGuard permission="accounting.manage_mappings"><PostingRuleFormPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/cash-bank-accounts" element={<AccountingSetupRouteGuard permission="accounting.manage_mappings"><CashBankAccountsPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/opening-balances" element={<AccountingSetupRouteGuard permission="accounting.manage_opening_balances"><OpeningBalancesPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/opening-balances/new" element={<AccountingSetupRouteGuard permission="accounting.manage_opening_balances"><OpeningBalanceNewPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/opening-balances/:batchId" element={<AccountingSetupRouteGuard permission="accounting.manage_opening_balances"><OpeningBalanceDetailPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/setup/readiness" element={<AccountingSetupRouteGuard permission="accounting.admin"><AccountingReadinessPage /></AccountingSetupRouteGuard>} />
              <Route path="/accounting/reports" element={<AccountingReportsRouteGuard><AccountingReportsCenterPage /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/journal" element={<AccountingReportsRouteGuard permission="accounting_reports.journal"><AccountingReportPage reportKey="journal" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/journal/:entryId" element={<AccountingReportsRouteGuard permission="accounting_reports.journal"><JournalEntryDetailPage /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/general-ledger" element={<AccountingReportsRouteGuard permission="accounting_reports.ledger"><AccountingReportPage reportKey="general-ledger" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/general-ledger/:accountId" element={<AccountingReportsRouteGuard permission="accounting_reports.ledger"><GeneralLedgerAccountPage /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/account-statement" element={<AccountingReportsRouteGuard permission="accounting_reports.ledger"><AccountingReportPage reportKey="account-statement" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/trial-balance" element={<AccountingReportsRouteGuard permission="accounting_reports.trial_balance"><AccountingReportPage reportKey="trial-balance" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/income-statement" element={<AccountingReportsRouteGuard permission="accounting_reports.income_statement"><AccountingReportPage reportKey="income-statement" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/balance-sheet" element={<AccountingReportsRouteGuard permission="accounting_reports.balance_sheet"><AccountingReportPage reportKey="balance-sheet" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/cash-flow" element={<AccountingReportsRouteGuard permission="accounting_reports.cash_flow"><AccountingReportPage reportKey="cash-flow" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/receivables" element={<AccountingReportsRouteGuard permission="accounting_reports.receivables"><AccountingReportPage reportKey="receivables" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/insurance-receivables" element={<AccountingReportsRouteGuard permission="accounting_reports.receivables"><AccountingReportPage reportKey="insurance-receivables" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/customer-receivables" element={<AccountingReportsRouteGuard permission="accounting_reports.receivables"><AccountingReportPage reportKey="customer-receivables" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/receivables-aging" element={<AccountingReportsRouteGuard permission="accounting_reports.receivables"><AccountingReportPage reportKey="receivables-aging" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/payables" element={<AccountingReportsRouteGuard permission="accounting_reports.payables"><AccountingReportPage reportKey="payables" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/supplier-statement" element={<AccountingReportsRouteGuard permission="accounting_reports.payables"><AccountingReportPage reportKey="supplier-statement" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/payables-aging" element={<AccountingReportsRouteGuard permission="accounting_reports.payables"><AccountingReportPage reportKey="payables-aging" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/cashbook" element={<AccountingReportsRouteGuard permission="accounting_reports.cash_bank"><AccountingReportPage reportKey="cashbook" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/bank-ledger" element={<AccountingReportsRouteGuard permission="accounting_reports.cash_bank"><AccountingReportPage reportKey="bank-ledger" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/cash-bank-summary" element={<AccountingReportsRouteGuard permission="accounting_reports.cash_bank"><AccountingReportPage reportKey="cash-bank-summary" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/revenue" element={<AccountingReportsRouteGuard permission="accounting_reports.revenue"><AccountingReportPage reportKey="revenue" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/expenses" element={<AccountingReportsRouteGuard permission="accounting_reports.expenses"><AccountingReportPage reportKey="expenses" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/vat" element={<AccountingReportsRouteGuard permission="accounting_reports.vat"><AccountingReportPage reportKey="vat" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/vat-output" element={<AccountingReportsRouteGuard permission="accounting_reports.vat"><AccountingReportPage reportKey="vat-output" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/vat-input" element={<AccountingReportsRouteGuard permission="accounting_reports.vat"><AccountingReportPage reportKey="vat-input" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/vehicle-profit-loss" element={<AccountingReportsRouteGuard permission="accounting_reports.vehicle_profit_loss"><AccountingReportPage reportKey="vehicle-profit-loss" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/vehicle-profit-loss/:operationId" element={<AccountingReportsRouteGuard permission="accounting_reports.vehicle_profit_loss"><VehicleProfitLossDetailPage /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/monthly-vehicle-profitability" element={<AccountingReportsRouteGuard permission="accounting_reports.vehicle_profit_loss"><MonthlyVehicleProfitabilityPage /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/cost-centers" element={<AccountingReportsRouteGuard permission="accounting_reports.cost_centers"><AccountingReportPage reportKey="cost-centers" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/audit-exceptions" element={<AccountingReportsRouteGuard permission="accounting_reports.audit"><AccountingReportPage reportKey="audit-exceptions" /></AccountingReportsRouteGuard>} />
              <Route path="/accounting/reports/unposted-documents" element={<AccountingReportsRouteGuard permission="accounting_reports.audit"><AccountingReportPage reportKey="unposted-documents" /></AccountingReportsRouteGuard>} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/inventory/purchase-invoices" element={<PurchaseInvoices />} />
              <Route path="/inventory/suppliers" element={<Suppliers />} />
              <Route path="/inventory/supplier-payments" element={<SupplierPayments />} />
              <Route path="/inventory/purchase-returns" element={<PurchaseReturns />} />
              <Route path="/inventory/supplier-balance" element={<SupplierBalanceReport />} />
              <Route path="/inventory/movements" element={<StockMovements />} />
              <Route path="/inventory/import-catalog" element={<PartsCatalogImport />} />
              <Route path="/inventory/:id" element={<InventoryDetail />} />
              <Route path="/staff" element={<Staff />} />
              <Route path="/staff/:id" element={<EmployeeDetail />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route
                path="/users"
                element={
                  <ProtectedRoute roles={["admin", "manager"]}>
                    <Users />
                  </ProtectedRoute>
                }
              />
              <Route element={<InsuranceLayout />}>
                <Route path="/insurance" element={<InsuranceHub />} />
                <Route path="/insurance/claims" element={<InsuranceClaimsList />} />
                <Route path="/insurance/claims/new" element={<Navigate to="/insurance/new" replace />} />
                <Route path="/insurance/claims/:claimId" element={<InsuranceClaimDetail />} />
                <Route path="/insurance/list" element={<InsuranceClaimsList />} />
                <Route path="/insurance/pipeline" element={<InsurancePipeline />} />
                <Route path="/insurance/alerts" element={<InsuranceAlertsCenter />} />
                <Route path="/insurance/payments" element={<InsurancePayments />} />
                <Route path="/insurance/investors-report" element={<InvestorsReport />} />
                <Route path="/insurance/companies" element={<InsuranceCompanies />} />
                <Route path="/insurance/work-orders" element={<InsuranceWorkOrders />} />
                <Route path="/insurance/accounting" element={<InsuranceAccounting />} />
                <Route path="/insurance/estimates" element={<InsuranceEstimates />} />
                <Route path="/insurance/independent-estimates" element={<InsuranceIndependentEstimates />} />
                <Route path="/insurance/documents" element={<InsuranceDocumentsArchive />} />
                <Route path="/insurance/import" element={<InsuranceImport />} />
                <Route path="/insurance/companies/:id" element={<InsuranceCompanyDetail />} />
                <Route path="/insurance/new" element={<NewInsuranceClaim />} />
                <Route path="/insurance/:id/archive" element={<ClaimArchivePage />} />
                <Route path="/insurance/:id/audit" element={<InsuranceClaimAuditPage />} />
                <Route path="/insurance/:id" element={<InsuranceClaimDetail />} />
              </Route>
              <Route path="/vehicles" element={<Vehicles />} />
              <Route path="/vehicles/:plate" element={<VehicleDetail />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/tasks" element={<DailyTasks />} />
              <Route path="/daily-log" element={<DailyLog />} />
              <Route path="/expenses/import" element={<ExpensesImport />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/reports" element={<ReportsLegacyRedirect to="/reports-center" />} />
              <Route path="/reports-center" element={<ReportsCenter />} />
              <Route path="/reports-legacy" element={<LegacyReports />} />
              <Route path="/reports-classic" element={<ClassicReports />} />
              <Route path="/reports/legacy" element={<ReportsLegacyRedirect to="/reports-legacy" />} />
              <Route path="/reports/center" element={<ReportsLegacyRedirect to="/reports-center" />} />
              <Route path="/reports/work-orders-statement" element={<ReportsLegacyRedirect to="/reports-center?report=work-orders&category=operations" />} />
              <Route path="/reports/parts-profit" element={<ReportsLegacyRedirect to="/reports-center?report=gross-profitability&category=profitability" />} />
              <Route path="/reports/monthly" element={<ReportsLegacyRedirect to="/reports-center?report=all-company-invoices&groupBy=month" />} />
              <Route path="/reports/completed-without-invoice" element={<ReportsLegacyRedirect to="/reports-center?report=completed-without-invoice&category=invoices" />} />
              <Route path="/reports/overdue-invoices" element={<ReportsLegacyRedirect to="/reports-center?report=delivered-awaiting-collection&category=invoices" />} />
              <Route path="/reports/vehicles-over-30-days" element={<ReportsLegacyRedirect to="/reports-center?report=workshop-duration&category=performance" />} />
              <Route path="/reports/cloud-advanced" element={<ReportsLegacyRedirect to="/reports-center?report=all-company-invoices&category=combined" />} />
              <Route path="/dashboard/executive" element={<ProtectedRoute roles={["admin", "manager", "accountant"]}><ExecutiveDashboard /></ProtectedRoute>} />
              <Route path="/media-studio" element={<MediaStudio />} />
              <Route path="/import-export" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ImportExportCenter /></ProtectedRoute>} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/roles" element={<Navigate to="/settings/roles-permissions" replace />} />
              <Route path="/settings/print-templates" element={<PrintTemplates />} />
              <Route path="/settings/print-templates/:docType" element={<PrintTemplateVariants />} />
              <Route path="/settings/print-templates/:docType/edit/:id" element={<PrintTemplateEditor />} />
              <Route path="/settings/expense-categories" element={<Navigate to="/accounting/expenses/categories" replace />} />
              <Route path="/settings/roles-permissions" element={<ProtectedRoute roles={["admin"]}><RolesPermissionsPage /></ProtectedRoute>} />
              <Route path="/settings/quick-actions" element={<QuickActionsSettingsPage />} />
              <Route path="/settings/data-migration" element={<ProtectedRoute roles={["admin"]}><DataMigrationPage /></ProtectedRoute>} />
              <Route path="/settings/modules" element={<ProtectedRoute roles={["admin","manager"]}><ModulesSettingsPage /></ProtectedRoute>} />
              <Route path="/settings/vehicles-cleanup" element={<ProtectedRoute roles={["admin","manager"]}><VehiclesCleanupPage /></ProtectedRoute>} />
              <Route path="/settings/public-access" element={<PublicAccessSettingsPage />} />
              <Route path="/settings/sms" element={<SmsSettingsPage />} />
              <Route path="/settings/tax" element={<TaxSettingsPage />} />
              <Route path="/settings/e-invoicing" element={<ProtectedRoute roles={["admin","manager","accountant"]}><EInvoicingSettingsPage /></ProtectedRoute>} />
              <Route path="/settings/integrations" element={<IntegrationsSettingsPage />} />
              <Route path="/settings/danger-zone" element={<ProtectedRoute roles={["admin"]}><SecurityDangerZone /></ProtectedRoute>} />
              <Route path="/settings/payment-gateways" element={<PaymentGatewaysPage />} />
              <Route path="/trash" element={<Navigate to="/settings/trash" replace />} />
              <Route path="/settings/trash" element={<ProtectedRoute roles={["admin"]}><TrashPage /></ProtectedRoute>} />
              <Route path="/settings/audit-log" element={<ProtectedRoute roles={["admin","manager","accountant"]}><AuditLogPage /></ProtectedRoute>} />
              <Route path="/settings/backup" element={<ProtectedRoute roles={["admin"]}><BackupRestorePage /></ProtectedRoute>} />
              <Route path="/settings/ai-keys" element={<ProtectedRoute roles={["admin"]}><AiKeysSettingsPage /></ProtectedRoute>} />
              <Route path="/settings/pdf-layout" element={<PdfLayoutPage />} />
              <Route path="/settings/pdf-qa" element={<ProtectedRoute roles={["admin","manager"]}><PdfQaPage /></ProtectedRoute>} />
              <Route path="/settings/numbering" element={<ProtectedRoute roles={["admin","manager"]}><NumberingSettingsPage /></ProtectedRoute>} />
              <Route path="/settings/vehicle-belongings" element={<ProtectedRoute roles={["admin","manager"]}><VehicleBelongingsSettingsPage /></ProtectedRoute>} />
              <Route path="/messages" element={<MessagesCenter />} />
              <Route path="/admin/notifications" element={<ProtectedRoute roles={["admin","manager"]}><AdminNotifications /></ProtectedRoute>} />
              <Route path="/admin/saas" element={<ProtectedRoute roles={["admin","manager"]}><SaasAdminConsole /></ProtectedRoute>} />
              <Route path="/admin/files" element={<ProtectedRoute roles={["admin","manager"]}><TenantFiles /></ProtectedRoute>} />
              <Route path="/settings/customer-notifications" element={<ProtectedRoute roles={["admin","manager"]}><CustomerNotificationsSettingsPage /></ProtectedRoute>} />
              <Route path="/settings/vehicle-stay-alerts" element={<ProtectedRoute roles={["admin","manager"]}><VehicleStayAlertsSettingsPage /></ProtectedRoute>} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </FeatureProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
