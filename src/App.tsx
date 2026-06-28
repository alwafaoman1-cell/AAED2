import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
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

import HomeShortcuts from "./pages/HomeShortcuts";

// Role-based home redirector: supervisors land on their mobile app, others see the shortcuts home.
function RoleHome() {
  const { profile } = useAuth();
  if (profile?.role === "supervisor") return <Navigate to="/supervisor-app" replace />;
  return <HomeShortcuts />;
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
const Sales = lazy(() => import("./pages/Sales"));
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
const ExpenseNew = lazy(() => import("./pages/accounting/ExpenseNew"));
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
const PublicTracking = lazy(() => import("./pages/PublicTracking"));
const PublicVehicleProfile = lazy(() => import("./pages/PublicVehicleProfile"));
const CustomerPortal = lazy(() => import("./pages/CustomerPortal"));
const TrashPage = lazy(() => import("./pages/TrashPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const Reports = lazy(() => import("./pages/Reports"));
const ReportsCenter = lazy(() => import("./pages/ReportsCenter"));
const WorkOrdersStatement = lazy(() => import("./pages/reports/WorkOrdersStatement"));
const PartsProfitReport = lazy(() => import("./pages/reports/PartsProfitReport"));
const MonthlyReport = lazy(() => import("./pages/reports/MonthlyReport"));
const CloudAdvancedReports = lazy(() => import("./pages/reports/CloudAdvancedReports"));
const CompletedWithoutInvoice = lazy(() => import("./pages/reports/CompletedWithoutInvoice"));
const OverdueInvoices = lazy(() => import("./pages/reports/OverdueInvoices"));
const ExecutiveDashboard = lazy(() => import("./pages/dashboard/ExecutiveDashboard"));
const PrintTemplates = lazy(() => import("./pages/settings/PrintTemplates"));
const PrintTemplateVariants = lazy(() => import("./pages/settings/PrintTemplateVariants"));
const PrintTemplateEditor = lazy(() => import("./pages/settings/PrintTemplateEditor"));
const ExpenseCategoriesPage = lazy(() => import("./pages/settings/ExpenseCategoriesPage"));
const RolesPermissionsPage = lazy(() => import("./pages/settings/RolesPermissionsPage"));
const VehiclesCleanupPage = lazy(() => import("./pages/settings/VehiclesCleanup"));
const QuickActionsSettingsPage = lazy(() => import("./pages/settings/QuickActionsSettingsPage"));
const ModulesSettingsPage = lazy(() => import("./pages/settings/ModulesSettingsPage"));
const DataMigrationPage = lazy(() => import("./pages/settings/DataMigrationPage"));
const PublicAccessSettingsPage = lazy(() => import("./pages/settings/PublicAccessSettingsPage"));
const SmsSettingsPage = lazy(() => import("./pages/settings/SmsSettingsPage"));
const TaxSettingsPage = lazy(() => import("./pages/settings/TaxSettingsPage"));
const IntegrationsSettingsPage = lazy(() => import("./pages/settings/IntegrationsSettingsPage"));
const PaymentGatewaysPage = lazy(() => import("./pages/settings/PaymentGatewaysPage"));
const BackupRestorePage = lazy(() => import("./pages/settings/BackupRestorePage"));
const AiKeysSettingsPage = lazy(() => import("./pages/settings/AiKeysSettingsPage"));
const PdfLayoutPage = lazy(() => import("./pages/settings/PdfLayoutPage"));
const PdfQaPage = lazy(() => import("./pages/settings/PdfQaPage"));
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
const WorkOrderSignPage = lazy(() => import("./pages/public/WorkOrderSignPage"));
const VehicleBelongingsSettingsPage = lazy(() => import("./pages/settings/VehicleBelongingsSettingsPage"));
const MessagesCenter = lazy(() => import("./pages/MessagesCenter"));
const CustomerNotificationsSettingsPage = lazy(() => import("./pages/settings/CustomerNotificationsSettingsPage"));
const AdminNotifications = lazy(() => import("./pages/AdminNotifications"));
const SaasAdminConsole = lazy(() => import("./pages/admin/SaasAdminConsole"));
const TenantFiles = lazy(() => import("./pages/admin/TenantFiles"));

import { setTemplateQueryClient } from "@/lib/printTemplates/resolver";
import { useAutoTranslate } from "@/i18n/autoTranslate";
import KeyboardShortcuts from "@/components/KeyboardShortcuts";
import SystemPreferencesBoot from "@/components/SystemPreferencesBoot";

// كاش حيّ — يعيد الجلب فور الدخول للصفحة لمنع عرض بيانات قديمة بين التنقّلات.
// المستخدم كان يضطر لـ Ctrl+Shift+R لأن staleTime كان 30s.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});
setTemplateQueryClient(queryClient);

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
          <KeyboardShortcuts />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/install" element={<InstallAppPage />} />
            <Route path="/track/:id" element={<PublicTracking />} />
            <Route path="/invoice/view/:token" element={<InvoicePublicView />} />
            <Route path="/p/:token" element={<CustomerPortal />} />
            <Route path="/v/:plate" element={<PublicVehicleProfile />} />
            <Route path="/c/approve/:token" element={<SupplementApprovalPage />} />
            <Route path="/sign/:token" element={<WorkOrderSignPage />} />
            <Route path="/tech" element={<ProtectedRoute><TechnicianApp /></ProtectedRoute>} />
            <Route path="/tech/scan" element={<ProtectedRoute><TechQrScanPage /></ProtectedRoute>} />
            <Route path="/manager-app" element={<ProtectedRoute roles={["admin","manager"]}><ManagerApp /></ProtectedRoute>} />
            <Route path="/accountant-app" element={<ProtectedRoute roles={["admin","manager","accountant"]}><AccountantApp /></ProtectedRoute>} />
            <Route path="/supervisor-app" element={<ProtectedRoute roles={["admin","manager","supervisor"]}><SupervisorApp /></ProtectedRoute>} />

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
              <Route path="/sales" element={<Sales />} />
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
              <Route path="/accounting" element={<ProtectedRoute roles={["admin","manager","accountant"]}><Accounting /></ProtectedRoute>} />
              <Route path="/accounting/expenses" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpenseNew /></ProtectedRoute>} />
              <Route path="/accounting/expenses/new" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ExpenseNew /></ProtectedRoute>} />
              <Route path="/accounting/receipts" element={<ProtectedRoute roles={["admin","manager","accountant"]}><Receipts /></ProtectedRoute>} />
              <Route path="/accounting/cashbox/topup" element={<ProtectedRoute roles={["admin","manager","accountant"]}><CashboxTopup /></ProtectedRoute>} />
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
                <Route path="/insurance/:id" element={<InsuranceClaimDetail />} />
              </Route>
              <Route path="/vehicles" element={<Vehicles />} />
              <Route path="/vehicles/:plate" element={<VehicleDetail />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/tasks" element={<DailyTasks />} />
              <Route path="/daily-log" element={<DailyLog />} />
              <Route path="/expenses/import" element={<ExpensesImport />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/reports/center" element={<ReportsCenter />} />
              <Route path="/reports/work-orders-statement" element={<WorkOrdersStatement />} />
              <Route path="/reports/parts-profit" element={<PartsProfitReport />} />
              <Route path="/reports/monthly" element={<MonthlyReport />} />
              <Route path="/reports/completed-without-invoice" element={<ProtectedRoute roles={["admin", "manager", "accountant"]}><CompletedWithoutInvoice /></ProtectedRoute>} />
              <Route path="/reports/overdue-invoices" element={<ProtectedRoute roles={["admin", "manager", "accountant"]}><OverdueInvoices /></ProtectedRoute>} />
              <Route path="/reports/cloud-advanced" element={<ProtectedRoute roles={["admin", "manager", "accountant", "insurance"]}><CloudAdvancedReports /></ProtectedRoute>} />
              <Route path="/dashboard/executive" element={<ProtectedRoute roles={["admin", "manager", "accountant"]}><ExecutiveDashboard /></ProtectedRoute>} />
              <Route path="/media-studio" element={<MediaStudio />} />
              <Route path="/import-export" element={<ProtectedRoute roles={["admin","manager","accountant"]}><ImportExportCenter /></ProtectedRoute>} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/roles" element={<Navigate to="/settings/roles-permissions" replace />} />
              <Route path="/settings/print-templates" element={<PrintTemplates />} />
              <Route path="/settings/print-templates/:docType" element={<PrintTemplateVariants />} />
              <Route path="/settings/print-templates/:docType/edit/:id" element={<PrintTemplateEditor />} />
              <Route path="/settings/expense-categories" element={<ExpenseCategoriesPage />} />
              <Route path="/settings/roles-permissions" element={<ProtectedRoute roles={["admin"]}><RolesPermissionsPage /></ProtectedRoute>} />
              <Route path="/settings/quick-actions" element={<QuickActionsSettingsPage />} />
              <Route path="/settings/data-migration" element={<ProtectedRoute roles={["admin"]}><DataMigrationPage /></ProtectedRoute>} />
              <Route path="/settings/modules" element={<ProtectedRoute roles={["admin","manager"]}><ModulesSettingsPage /></ProtectedRoute>} />
              <Route path="/settings/vehicles-cleanup" element={<ProtectedRoute roles={["admin","manager"]}><VehiclesCleanupPage /></ProtectedRoute>} />
              <Route path="/settings/public-access" element={<PublicAccessSettingsPage />} />
              <Route path="/settings/sms" element={<SmsSettingsPage />} />
              <Route path="/settings/tax" element={<TaxSettingsPage />} />
              <Route path="/settings/integrations" element={<IntegrationsSettingsPage />} />
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
