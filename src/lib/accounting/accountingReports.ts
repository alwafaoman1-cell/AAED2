import { supabase } from "@/integrations/supabase/client";

export type AccountingReportKey =
  | "journal" | "general-ledger" | "account-statement" | "trial-balance"
  | "income-statement" | "balance-sheet" | "cash-flow" | "receivables"
  | "insurance-receivables" | "customer-receivables" | "receivables-aging"
  | "payables" | "supplier-statement" | "payables-aging" | "cashbook"
  | "bank-ledger" | "cash-bank-summary" | "revenue" | "expenses" | "vat"
  | "vat-output" | "vat-input" | "vehicle-profit-loss" | "cost-centers"
  | "audit-exceptions" | "unposted-documents";

export interface AccountingReportDefinition {
  key: AccountingReportKey;
  path: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  permission: string;
  orientation?: "portrait" | "landscape";
}

const report = (key: AccountingReportKey, path: string, titleAr: string, titleEn: string, permission: string, orientation: "portrait" | "landscape" = "landscape"): AccountingReportDefinition => ({
  key, path, titleAr, titleEn, permission, orientation,
  descriptionAr: "تقرير محاسبي من القيود المرحلة مع استبعاد السجلات غير المؤهلة.",
  descriptionEn: "Accounting report based on posted journal entries with centralized eligibility.",
});

export const ACCOUNTING_REPORTS: AccountingReportDefinition[] = [
  report("journal","journal","دفتر القيود اليومية","Journal","accounting_reports.journal"),
  report("general-ledger","general-ledger","دفتر الأستاذ العام","General Ledger","accounting_reports.ledger"),
  report("account-statement","account-statement","كشف حساب","Account Statement","accounting_reports.ledger"),
  report("trial-balance","trial-balance","ميزان المراجعة","Trial Balance","accounting_reports.trial_balance"),
  report("income-statement","income-statement","قائمة الدخل","Income Statement","accounting_reports.income_statement","portrait"),
  report("balance-sheet","balance-sheet","المركز المالي","Balance Sheet","accounting_reports.balance_sheet","portrait"),
  report("cash-flow","cash-flow","التدفقات النقدية","Cash Flow","accounting_reports.cash_flow","portrait"),
  report("receivables","receivables","الذمم المدينة","Receivables","accounting_reports.receivables"),
  report("insurance-receivables","insurance-receivables","ذمم شركات التأمين","Insurance Receivables","accounting_reports.receivables"),
  report("customer-receivables","customer-receivables","ذمم عملاء الكاش","Customer Receivables","accounting_reports.receivables"),
  report("receivables-aging","receivables-aging","أعمار الديون المدينة","Receivables Aging","accounting_reports.receivables"),
  report("payables","payables","الذمم الدائنة","Payables","accounting_reports.payables"),
  report("supplier-statement","supplier-statement","كشف حساب المورد","Supplier Statement","accounting_reports.payables"),
  report("payables-aging","payables-aging","أعمار ديون الموردين","Payables Aging","accounting_reports.payables"),
  report("cashbook","cashbook","دفتر الصندوق","Cashbook","accounting_reports.cash_bank"),
  report("bank-ledger","bank-ledger","حركة البنوك","Bank Ledger","accounting_reports.cash_bank"),
  report("cash-bank-summary","cash-bank-summary","ملخص الصندوق والبنوك","Cash & Bank Summary","accounting_reports.cash_bank"),
  report("revenue","revenue","الإيرادات","Revenue","accounting_reports.revenue"),
  report("expenses","expenses","المصروفات","Expenses","accounting_reports.expenses"),
  report("vat","vat","ضريبة القيمة المضافة","VAT","accounting_reports.vat"),
  report("vat-output","vat-output","ضريبة المخرجات","Output VAT","accounting_reports.vat"),
  report("vat-input","vat-input","ضريبة المدخلات","Input VAT","accounting_reports.vat"),
  report("vehicle-profit-loss","vehicle-profit-loss","الربح والخسارة لكل مركبة","Vehicle Profit & Loss","accounting_reports.vehicle_profit_loss"),
  report("cost-centers","cost-centers","مراكز التكلفة","Cost Centers","accounting_reports.cost_centers"),
  report("audit-exceptions","audit-exceptions","الاستثناءات المحاسبية","Accounting Exceptions","accounting_reports.audit"),
  report("unposted-documents","unposted-documents","المستندات غير المرحلة","Unposted Documents","accounting_reports.audit"),
];

export interface AccountingReportFilters {
  from: string; to: string; page: number; pageSize: number; search: string;
  accountId?: string; costCenterId?: string; status?: string; businessType?: string;
  entryId?: string; workOrderId?: string;
  sort?: string; direction?: "asc" | "desc";
}

export type AccountingReportRow = Record<string, unknown>;
export interface AccountingReportResult {
  reportKey: string; basis: string; available: boolean; rows: AccountingReportRow[];
  aggregates: Record<string, number>; pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
  dataQuality: { status: string; excludedRecordsApplied: boolean }; generatedAt: string;
}

export async function fetchAccountingReport(key: AccountingReportKey, filters: AccountingReportFilters, signal?: AbortSignal): Promise<AccountingReportResult> {
  if(key==="vehicle-profit-loss"){
    const result=await supabase.rpc("accounting_vehicle_profit_loss_rpc" as never,{p_from:filters.from||null,p_to:filters.to||null,p_page:filters.page,p_page_size:filters.pageSize,p_search:filters.search||null,p_filters:{work_order_id:filters.workOrderId||null,business_type:filters.businessType||null}} as never).abortSignal(signal??new AbortController().signal);
    if(result.error)throw result.error;return result.data as unknown as AccountingReportResult;
  }
  const result = await supabase.rpc("accounting_report_rpc" as never, {
    p_report_key:key,p_from:filters.from||null,p_to:filters.to||null,p_page:filters.page,
    p_page_size:filters.pageSize,p_search:filters.search||null,
    p_filters:{account_id:filters.accountId||null,cost_center_id:filters.costCenterId||null,status:filters.status||null,business_type:filters.businessType||null,entry_id:filters.entryId||null,work_order_id:filters.workOrderId||null},
    p_sort:filters.sort||"date",p_direction:filters.direction||"desc",
  } as never).abortSignal(signal ?? new AbortController().signal);
  if (result.error) throw result.error;
  return result.data as unknown as AccountingReportResult;
}

export async function fetchAllAccountingReportRows(key: AccountingReportKey, filters: AccountingReportFilters): Promise<AccountingReportRow[]> {
  const rows: AccountingReportRow[]=[];
  for(let page=1;page<=200;page+=1){
    const result=await fetchAccountingReport(key,{...filters,page,pageSize:500});
    rows.push(...result.rows);
    if(page>=result.pagination.totalPages) break;
  }
  return rows;
}

export interface SavedAccountingView { id:string; report_key:string; name:string; filters:Record<string,unknown>; columns:unknown[] }
export async function listAccountingSavedViews(reportKey: AccountingReportKey): Promise<SavedAccountingView[]> {
  const {data,error}=await supabase.from("accounting_report_saved_views" as never).select("id,report_key,name,filters,columns").eq("report_key",reportKey).order("name");
  if(error) throw error; return (data??[]) as unknown as SavedAccountingView[];
}
export async function saveAccountingView(tenantId:string,userId:string,reportKey:AccountingReportKey,name:string,filters:AccountingReportFilters){
  const {error}=await supabase.from("accounting_report_saved_views" as never).upsert({tenant_id:tenantId,user_id:userId,report_key:reportKey,name:name.trim(),filters,columns:[]} as never,{onConflict:"tenant_id,user_id,report_key,name"} as never);
  if(error) throw error;
}

export const accountingReportQueryKeys={
  all:["accounting-reports"] as const,
  report:(tenantId:string|undefined,key:AccountingReportKey,filters:AccountingReportFilters)=>["accounting-reports",tenantId,key,filters] as const,
  saved:(tenantId:string|undefined,key:AccountingReportKey)=>["accounting-report-saved-views",tenantId,key] as const,
};

export function accountingReportColumns(rows:AccountingReportRow[]){
  const priority=["entry_number","date","account_code","name_ar","name_en","description","debit","credit","balance","revenue","cost","profit","status"];
  const keys=Array.from(new Set(rows.flatMap(row=>Object.keys(row)))).filter(key=>!["id","account_id","journal_entry_id","party_id","vehicle_id","work_order_id","claim_id","invoice_id","payment_id","expense_id"].includes(key));
  return keys.sort((a,b)=>(priority.indexOf(a)<0?999:priority.indexOf(a))-(priority.indexOf(b)<0?999:priority.indexOf(b)));
}
