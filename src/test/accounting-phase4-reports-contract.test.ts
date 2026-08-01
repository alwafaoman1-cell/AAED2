import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";
import {ACCOUNTING_REPORTS} from "@/lib/accounting/accountingReports";
import {buildReportWorkbook} from "@/lib/reports-center/reportExportService";

const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("Phase 4 standalone accounting reports",()=>{
  it("defines every required report and 30 standalone routes",()=>{
    expect(ACCOUNTING_REPORTS).toHaveLength(26);
    const app=read("src/App.tsx");
    const routes=["/accounting/reports","/accounting/reports/journal","/accounting/reports/journal/:entryId","/accounting/reports/general-ledger","/accounting/reports/general-ledger/:accountId","/accounting/reports/account-statement","/accounting/reports/trial-balance","/accounting/reports/income-statement","/accounting/reports/balance-sheet","/accounting/reports/cash-flow","/accounting/reports/receivables","/accounting/reports/insurance-receivables","/accounting/reports/customer-receivables","/accounting/reports/receivables-aging","/accounting/reports/payables","/accounting/reports/supplier-statement","/accounting/reports/payables-aging","/accounting/reports/cashbook","/accounting/reports/bank-ledger","/accounting/reports/cash-bank-summary","/accounting/reports/revenue","/accounting/reports/expenses","/accounting/reports/vat","/accounting/reports/vat-output","/accounting/reports/vat-input","/accounting/reports/vehicle-profit-loss","/accounting/reports/vehicle-profit-loss/:operationId","/accounting/reports/cost-centers","/accounting/reports/audit-exceptions","/accounting/reports/unposted-documents"];
    routes.forEach(route=>expect(app).toContain(`path="${route}"`));
  });
  it("uses pages rather than modal, dialog, drawer or popup",()=>{
    const page=read("src/pages/accounting/reports/AccountingReportsPages.tsx");
    expect(page).not.toMatch(/<Dialog|<Drawer|<Modal|window\.open\(/);
    expect(page).toContain("useSearchParams");
    expect(page).toContain("refetchOnWindowFocus:false");
  });
  it("uses server pagination, cancellation and centralized query keys",()=>{
    const service=read("src/lib/accounting/accountingReports.ts");
    expect(service).toContain('accounting_report_rpc');
    expect(service).toContain('.abortSignal(');
    expect(service).toContain('p_page_size');
    expect(service).toContain('accountingReportQueryKeys');
  });
  it("keeps reports hidden in production unless explicitly enabled",()=>{
    const availability=read("src/lib/accounting/accountingReportsAvailability.ts");
    expect(availability).toContain("import.meta.env.DEV");
    expect(availability).toContain('VITE_ACCOUNTING_REPORTS_ENABLED==="true"');
  });
  it("enforces database eligibility, tenant and report permissions",()=>{
    const sql=read("supabase/migrations/20260801120000_accounting_reports_standalone.sql");
    ["cancelled","void","deleted","failed","reversed","archived"].forEach(status=>expect(sql).toContain(`'${status}'`));
    expect(sql).toContain("public.get_user_tenant_id()");
    expect(sql).toContain("ACCOUNTING_REPORT_PERMISSION_DENIED");
    expect(sql).toContain("revoke all on function public.accounting_report_rpc");
    expect(sql).toContain("from public,anon");
  });
  it("keeps vehicle P&L invoice-based, expense-based and parity-visible",()=>{
    const sql=read("supabase/migrations/20260801122000_accounting_vehicle_profit_loss_eligible.sql");
    expect(sql).toContain("sum(i.subtotal)");
    expect(sql).toContain("reports_expense_facts_v1");
    expect(sql).toContain("old_result");
    expect(sql).toContain("eligible_old_result");
    expect(sql).toContain("0::numeric difference");
    expect(sql).not.toContain("jo.parts_cost");
    expect(sql).not.toContain("jo.labor_cost");
  });
  it("creates a real two-sheet XLSX with filters, freeze panes and OMR precision",()=>{
    const wb=buildReportWorkbook({fileName:"phase4.xlsx",sheetName:"Journal",title:"Journal",filters:[{label:"From",value:"2026-08-01"}],columns:[{key:"debit",label:"Debit",type:"money"}],rows:[{debit:100}],language:"en"});
    expect(wb.SheetNames).toEqual(["Summary","Journal"]);
    expect(wb.Sheets.Journal["!autofilter"]).toBeTruthy();
    expect(wb.Sheets.Journal["!freeze"]).toBeTruthy();
    expect(wb.Sheets.Journal.A7?.z).toBe('0.000 "OMR"');
  });
  it("does not activate posting or backfill",()=>{
    const migrations=read("supabase/migrations/20260801120000_accounting_reports_standalone.sql")+read("supabase/migrations/20260801122000_accounting_vehicle_profit_loss_eligible.sql");
    expect(migrations).not.toMatch(/create\s+trigger[\s\S]*(invoice|payment|expense)/i);
    expect(migrations).not.toMatch(/update\s+(public\.)?(invoices|insurance_invoices|expenses|claim_payments)/i);
  });
});
