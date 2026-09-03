import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { MonthlyVehicleProfitabilityRow } from "@/lib/accounting/monthlyVehicleProfitability";
import { readCloudSetting } from "@/lib/cloudSettings";

export type MonthlyExpenseRow = Record<string, unknown>;
export type MonthlyExpenseGroup = Record<string, unknown>;

export interface MonthlyWorkshopOverheads {
  summary: {
    subtotal: number; vat: number; total: number; salaries: number; fixed: number;
    operating: number; unlinked_parts: number; other: number; count: number;
  };
  groups: MonthlyExpenseGroup[];
  expenseRows: MonthlyExpenseRow[];
  payrollRows: MonthlyExpenseRow[];
  basis: string;
  generatedAt: string;
}

interface MonthlyFixedCostSetting {
  id: string;
  name: string;
  amount: number;
  active: boolean;
}

interface MonthlySettingsSnapshot {
  fixedCosts?: MonthlyFixedCostSetting[];
  defaultMonthlySalariesTotal?: number;
}

interface HrEmployeeSnapshot {
  id: string;
  name: string;
  nameEn?: string;
  position?: string;
  hireDate?: string;
  employmentStatus?: string;
  contractEndDate?: string;
  baseSalary?: number;
  housingAllowance?: number;
  transportAllowance?: number;
  otherAllowances?: number;
  isDeleted?: boolean;
}

interface HrAdjustmentSnapshot {
  employeeId: string;
  date: string;
  amount: number;
  status?: string;
  monthlyDeduction?: number;
}

interface HrPayslipSnapshot {
  id: string;
  employeeId: string;
  month: string;
  netSalary: number;
  paidAt?: string;
}

interface HrSnapshot {
  employees?: HrEmployeeSnapshot[];
  advances?: HrAdjustmentSnapshot[];
  deductions?: HrAdjustmentSnapshot[];
  bonuses?: HrAdjustmentSnapshot[];
  payslips?: HrPayslipSnapshot[];
}

const EMPTY_HR: HrSnapshot = { employees: [], advances: [], deductions: [], bonuses: [], payslips: [] };
const EMPTY_MONTHLY_SETTINGS: MonthlySettingsSnapshot = { fixedCosts: [], defaultMonthlySalariesTotal: 0 };

function number(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthKeys(from: string, to: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00`);
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00`);
  while (cursor <= end) {
    result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

function classifyExpenseRow(row: MonthlyExpenseRow): "salaries" | "fixed" | "operating" | "unlinked_parts" | "other" {
  const text = [
    row.accounting_mapping_key, row.department_ar, row.department_en, row.category_ar,
    row.category_en, row.subcategory_ar, row.subcategory_en, row.description,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  if (String(row.accounting_mapping_key || "") === "salary_expense" || /(salary|payroll|wage|hr_salary|راتب|رواتب|أجور)/i.test(text)) return "salaries";
  if (/(rent|lease|subscription|license|depreciation|إيجار|ايجار|اشتراك|رخص|استهلاك)/i.test(text)) return "fixed";
  if (/(part|spare|قطع|غيار)/i.test(text)) return "unlinked_parts";
  if (/(electric|water|telephone|internet|fuel|tool|maintenance|admin|utility|كهرب|ماء|هاتف|انترنت|وقود|أدوات|صيانة|إدار)/i.test(text)) return "operating";
  return "other";
}

function adjustmentTotal(rows: HrAdjustmentSnapshot[] | undefined, employeeId: string, month: string): number {
  return (rows || []).filter((row) => row.employeeId === employeeId && String(row.date || "").startsWith(month))
    .reduce((sum, row) => sum + number(row.amount), 0);
}

function advanceDeductionTotal(rows: HrAdjustmentSnapshot[] | undefined, employeeId: string, month: string): number {
  return (rows || []).filter((row) => row.employeeId === employeeId && ["approved", "paid", "deducted"].includes(String(row.status || "")))
    .reduce((sum, row) => {
      if (String(row.date || "").slice(0, 7) > month) return sum;
      return sum + number(row.monthlyDeduction);
    }, 0);
}

function normalizedPersonName(value: unknown): string {
  return String(value || "").trim().toLocaleLowerCase("ar").replace(/\s+/g, " ");
}

function generatedPayrollRows(hr: HrSnapshot, settings: MonthlySettingsSnapshot, month: string): MonthlyExpenseRow[] {
  const payslips = (hr.payslips || []).filter((row) => row.month === month);
  if (payslips.length) {
    const employees = new Map((hr.employees || []).map((employee) => [employee.id, employee]));
    return payslips.map((payslip) => {
      const employee = employees.get(payslip.employeeId);
      return {
        id: `hr-payslip-${payslip.id}`, date: payslip.paidAt?.slice(0, 10) || `${month}-01`,
        voucher_number: `HR-${month}-${payslip.id.slice(-6)}`, beneficiary: employee?.name || "موظف",
        supplier_name: employee?.name || "موظف", description: `راتب ${employee?.name || "موظف"} — ${month}`,
        department_ar: "الموارد البشرية", department_en: "Human Resources", category_ar: "الرواتب والأجور",
        category_en: "Payroll", subcategory_ar: employee?.position || "راتب شهري", subcategory_en: "Monthly salary",
        subtotal: number(payslip.netSalary), vat: 0, total: number(payslip.netSalary),
        accounting_mapping_key: "salary_expense", source_basis: "hr_payslip", generated: true,
      };
    }).filter((row) => number(row.subtotal) > 0);
  }

  const employees = (hr.employees || []).filter((employee) => {
    if (employee.isDeleted || (employee.hireDate && employee.hireDate.slice(0, 7) > month)) return false;
    if (["active", "on_leave"].includes(String(employee.employmentStatus || "active"))) return true;
    return Boolean(employee.contractEndDate && employee.contractEndDate.slice(0, 7) >= month);
  });
  const rows = employees.map((employee) => {
    const gross = number(employee.baseSalary) + number(employee.housingAllowance) + number(employee.transportAllowance) + number(employee.otherAllowances)
      + adjustmentTotal(hr.bonuses, employee.id, month);
    const net = Math.max(0, gross - adjustmentTotal(hr.deductions, employee.id, month) - advanceDeductionTotal(hr.advances, employee.id, month));
    return {
      id: `hr-accrual-${employee.id}-${month}`, date: `${month}-01`, voucher_number: `HR-AUTO-${month}`,
      beneficiary: employee.name, supplier_name: employee.name, description: `استحقاق راتب ${employee.name} — ${month}`,
      department_ar: "الموارد البشرية", department_en: "Human Resources", category_ar: "الرواتب والأجور",
      category_en: "Payroll", subcategory_ar: employee.position || "راتب شهري", subcategory_en: "Monthly salary",
      subtotal: net, vat: 0, total: net, accounting_mapping_key: "salary_expense", source_basis: "hr_accrual", generated: true,
    } satisfies MonthlyExpenseRow;
  }).filter((row) => number(row.subtotal) > 0);
  if (rows.length || !number(settings.defaultMonthlySalariesTotal)) return rows;
  const fallback = number(settings.defaultMonthlySalariesTotal);
  return [{
    id: `hr-default-${month}`, date: `${month}-01`, voucher_number: `HR-DEFAULT-${month}`, beneficiary: "الرواتب الشهرية",
    supplier_name: "الرواتب الشهرية", description: `إجمالي الرواتب الافتراضي — ${month}`, department_ar: "الموارد البشرية",
    department_en: "Human Resources", category_ar: "الرواتب والأجور", category_en: "Payroll", subcategory_ar: "إجمالي افتراضي",
    subcategory_en: "Default payroll total", subtotal: fallback, vat: 0, total: fallback, accounting_mapping_key: "salary_expense",
    source_basis: "monthly_settings", generated: true,
  }];
}

function payrollAccrualRowsForMonth(
  actualMonthRows: MonthlyExpenseRow[],
  hr: HrSnapshot,
  settings: MonthlySettingsSnapshot,
  month: string,
): MonthlyExpenseRow[] {
  const actualPayrollRows = actualMonthRows.filter((row) => classifyExpenseRow(row) === "salaries");
  const generatedRows = generatedPayrollRows(hr, settings, month);
  if (!actualPayrollRows.length) return generatedRows;

  const employeeNames = new Set(
    (hr.employees || []).flatMap((employee) => [normalizedPersonName(employee.name), normalizedPersonName(employee.nameEn)]).filter(Boolean),
  );
  const coveredNames = new Set(
    actualPayrollRows
      .flatMap((row) => [normalizedPersonName(row.beneficiary), normalizedPersonName(row.supplier_name)])
      .filter((name) => employeeNames.has(name)),
  );

  // A consolidated or otherwise unmatchable payroll voucher is authoritative for
  // the month. Generating employee accruals beside it would double-count payroll.
  if (!coveredNames.size) return [];
  return generatedRows.filter((row) => !coveredNames.has(normalizedPersonName(row.beneficiary || row.supplier_name)));
}

function generatedFixedRows(settings: MonthlySettingsSnapshot, month: string): MonthlyExpenseRow[] {
  return (settings.fixedCosts || []).filter((item) => item.active && number(item.amount) > 0).map((item) => ({
    id: `fixed-${item.id}-${month}`, date: `${month}-01`, voucher_number: `FIXED-AUTO-${month}`, beneficiary: item.name,
    supplier_name: item.name, description: `${item.name} — ${month}`, department_ar: "تشغيل الورشة", department_en: "Workshop Operations",
    category_ar: "التكاليف الثابتة", category_en: "Fixed Costs", subcategory_ar: item.name, subcategory_en: item.name,
    subtotal: number(item.amount), vat: 0, total: number(item.amount), accounting_mapping_key: "fixed_expense",
    source_basis: "fixed_cost_setting", generated: true,
  }));
}

function mergeGroup(rows: MonthlyExpenseRow[]): MonthlyExpenseGroup[] {
  const groups = new Map<string, MonthlyExpenseGroup>();
  for (const row of rows) {
    const key = [row.department_ar, row.category_ar, row.subcategory_ar].join("|");
    const current = groups.get(key) || {
      department_code: row.generated ? "AUTO" : "SOURCE", department_ar: row.department_ar || "غير مصنف", department_en: row.department_en || "Unclassified",
      category_code: row.generated ? "AUTO" : "SOURCE", category_ar: row.category_ar || "غير مصنف", category_en: row.category_en || "Unclassified",
      subcategory_code: row.generated ? "AUTO" : "SOURCE", subcategory_ar: row.subcategory_ar || "", subcategory_en: row.subcategory_en || "",
      expense_count: 0, subtotal: 0, vat: 0, total: 0,
    };
    current.expense_count = number(current.expense_count) + 1;
    current.subtotal = number(current.subtotal) + number(row.subtotal);
    current.vat = number(current.vat) + number(row.vat);
    current.total = number(current.total) + number(row.total);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => String(a.department_ar).localeCompare(String(b.department_ar), "ar"));
}

export const monthlyWorkshopReportKeys = {
  overheads: (tenantId: string | undefined, from: string, to: string) =>
    ["monthly-workshop-report", "overheads", tenantId, from, to] as const,
};

export function composeMonthlyWorkshopOverheads(
  source: MonthlyWorkshopOverheads,
  hr: HrSnapshot,
  settings: MonthlySettingsSnapshot,
  from: string,
  to: string,
): MonthlyWorkshopOverheads {
  const actualRows: MonthlyExpenseRow[] = (source.expenseRows || []).map((row) => ({
    ...row,
    source_basis: row.source_basis || "actual_voucher",
    generated: false,
  } as MonthlyExpenseRow));
  const generated: MonthlyExpenseRow[] = [];
  for (const month of monthKeys(from, to)) {
    const monthRows = actualRows.filter((row) => String(row.date || "").startsWith(month));
    generated.push(...payrollAccrualRowsForMonth(monthRows, hr, settings, month));
    if (!monthRows.some((row) => classifyExpenseRow(row) === "fixed")) generated.push(...generatedFixedRows(settings, month));
  }
  const expenseRows = [...actualRows, ...generated].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const payrollRows = expenseRows.filter((row) => classifyExpenseRow(row) === "salaries");
  const summary = {
    subtotal: expenseRows.reduce((sum, row) => sum + number(row.subtotal), 0),
    vat: expenseRows.reduce((sum, row) => sum + number(row.vat), 0),
    total: expenseRows.reduce((sum, row) => sum + number(row.total), 0),
    salaries: expenseRows.filter((row) => classifyExpenseRow(row) === "salaries").reduce((sum, row) => sum + number(row.subtotal), 0),
    fixed: expenseRows.filter((row) => classifyExpenseRow(row) === "fixed").reduce((sum, row) => sum + number(row.subtotal), 0),
    operating: expenseRows.filter((row) => classifyExpenseRow(row) === "operating").reduce((sum, row) => sum + number(row.subtotal), 0),
    unlinked_parts: expenseRows.filter((row) => classifyExpenseRow(row) === "unlinked_parts").reduce((sum, row) => sum + number(row.subtotal), 0),
    other: expenseRows.filter((row) => classifyExpenseRow(row) === "other").reduce((sum, row) => sum + number(row.subtotal), 0),
    count: expenseRows.length,
  };
  return {
    ...source, summary, groups: mergeGroup(expenseRows), expenseRows, payrollRows,
    basis: `${source.basis}; HR and fixed-cost settings are accrued only when they are not covered by actual vouchers`,
  };
}

export async function fetchMonthlyWorkshopOverheads(from: string, to: string, signal?: AbortSignal) {
  const requestSignal = signal ?? new AbortController().signal;
  const [result, hr, settings] = await Promise.all([
    supabase.rpc("monthly_workshop_overheads_rpc" as never, { p_from: from, p_to: to } as never).abortSignal(requestSignal),
    readCloudSetting<HrSnapshot>("alwafa_hr_v1", EMPTY_HR),
    readCloudSetting<MonthlySettingsSnapshot>("alwafa_monthly_settings_v1", EMPTY_MONTHLY_SETTINGS),
  ]);
  if (result.error) throw result.error;
  return composeMonthlyWorkshopOverheads(result.data as unknown as MonthlyWorkshopOverheads, hr, settings, from, to);
}

function sheet(rows: unknown[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) {
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: rows.length - 1, c: widths.length - 1 }) };
    ws["!freeze"] = { xSplit: 0, ySplit: 1 } as never;
  }
  return ws;
}

export function exportMonthlyWorkshopWorkbook(input: {
  from: string;
  to: string;
  cashRows: MonthlyVehicleProfitabilityRow[];
  insuranceRows: MonthlyVehicleProfitabilityRow[];
  overheads: MonthlyWorkshopOverheads;
  cashSummary: Record<string, number>;
  insuranceSummary: Record<string, number>;
}) {
  const { from, to, cashRows, insuranceRows, overheads, cashSummary, insuranceSummary } = input;
  const wb = XLSX.utils.book_new();
  const cashGross = Number(cashSummary.gross_profit || 0);
  const insuranceGross = Number(insuranceSummary.gross_profit || 0);
  const overhead = Number(overheads.summary.subtotal || 0);
  XLSX.utils.book_append_sheet(wb, sheet([
    ["البيان", "الكاش", "التأمين", "الإجمالي"],
    ["الإيراد المحقق من دفعات الشهر قبل الضريبة", cashSummary.recognized_revenue_ex_vat || cashSummary.invoiced_ex_vat || 0, insuranceSummary.recognized_revenue_ex_vat || insuranceSummary.invoiced_ex_vat || 0, Number(cashSummary.recognized_revenue_ex_vat || cashSummary.invoiced_ex_vat || 0) + Number(insuranceSummary.recognized_revenue_ex_vat || insuranceSummary.invoiced_ex_vat || 0)],
    ["أجرة العمل/الخدمة المفوترة", cashSummary.labor_revenue || 0, insuranceSummary.labor_revenue || 0, Number(cashSummary.labor_revenue || 0) + Number(insuranceSummary.labor_revenue || 0)],
    ["إيراد قطع الغيار", cashSummary.parts_revenue || 0, insuranceSummary.parts_revenue || 0, Number(cashSummary.parts_revenue || 0) + Number(insuranceSummary.parts_revenue || 0)],
    ["الضريبة", cashSummary.vat || 0, insuranceSummary.vat || 0, Number(cashSummary.vat || 0) + Number(insuranceSummary.vat || 0)],
    ["المبلغ المحصل", cashSummary.collected || 0, insuranceSummary.collected || 0, Number(cashSummary.collected || 0) + Number(insuranceSummary.collected || 0)],
    ["التكلفة المباشرة", cashSummary.direct_cost || 0, insuranceSummary.direct_cost || 0, Number(cashSummary.direct_cost || 0) + Number(insuranceSummary.direct_cost || 0)],
    ["الربح المباشر", cashGross, insuranceGross, cashGross + insuranceGross],
    ["المصروفات العامة قبل الضريبة", "", "", overhead],
    ["صافي ربح/خسارة الشهر", "", "", cashGross + insuranceGross - overhead],
  ], [34, 18, 18, 18]), "الملخص");

  const vehicleHeaders = ["النوع","أمر العمل","المطالبة","العميل","الهاتف","اللوحة","الماركة","الموديل","الفواتير","الإيراد المحقق قبل الضريبة","أجرة العمل/الخدمة المحققة","إيراد قطع الغيار المحقق","VAT المحقق","المحصل","المستحق","تكلفة شراء قطع الغيار","تكلفة عمالة خارجية","تكاليف خارجية مباشرة","التكلفة المباشرة للشهر","الربح/الخسارة للشهر"];
  const vehicleData = (kind: string, rows: MonthlyVehicleProfitabilityRow[]) => rows.map((row) => [kind,row.work_order_number,row.claim_number,row.customer_name,row.customer_phone,`${row.plate_number || ""} ${row.plate_letters || ""}`.trim(),row.brand,row.model,row.invoice_numbers,row.invoiced_ex_vat,row.labor_revenue,row.parts_revenue,row.vat,row.collected,row.outstanding,row.parts_cost,row.labor_cost,row.external_direct_cost,row.direct_cost,row.gross_profit]);
  XLSX.utils.book_append_sheet(wb, sheet([vehicleHeaders,...vehicleData("كاش",cashRows),...vehicleData("تأمين",insuranceRows)], [12,18,22,28,16,16,16,18,24,16,22,18,14,16,16,22,20,22,18,18]), "ربحية السيارات");

  XLSX.utils.book_append_sheet(wb, sheet([["التاريخ","السند","القسم","التصنيف","الفرعي","المورد/المستفيد","البيان","أساس الاحتساب","قبل الضريبة","VAT","الإجمالي"],...overheads.expenseRows.map((row) => [row.date,row.voucher_number,row.department_ar,row.category_ar,row.subcategory_ar,row.supplier_name,row.description,row.source_basis || "actual_voucher",row.subtotal,row.vat,row.total])], [14,18,20,24,24,24,36,22,16,14,16]), "المصروفات العامة");
  XLSX.utils.book_append_sheet(wb, sheet([["التاريخ","السند","الموظف/المستفيد","التصنيف","البيان","أساس الاحتساب","قبل الضريبة","VAT","الإجمالي"],...overheads.payrollRows.map((row) => [row.date,row.voucher_number,row.beneficiary || row.supplier_name,row.subcategory_ar || row.category_ar,row.description,row.source_basis || "actual_voucher",row.subtotal,row.vat,row.total])], [14,18,26,24,36,22,16,14,16]), "الرواتب");

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 1; r <= range.e.r; r += 1) for (let c = 0; c <= range.e.c; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === "n") cell.z = '0.000 "OMR"';
    }
  }
  XLSX.writeFile(wb, `Monthly_Workshop_Report_${from}_${to}.xlsx`);
}
