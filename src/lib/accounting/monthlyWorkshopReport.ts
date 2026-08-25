import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { MonthlyVehicleProfitabilityRow } from "@/lib/accounting/monthlyVehicleProfitability";

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

export const monthlyWorkshopReportKeys = {
  overheads: (tenantId: string | undefined, from: string, to: string) =>
    ["monthly-workshop-report", "overheads", tenantId, from, to] as const,
};

export async function fetchMonthlyWorkshopOverheads(from: string, to: string, signal?: AbortSignal) {
  const result = await supabase.rpc("monthly_workshop_overheads_rpc" as never, {
    p_from: from, p_to: to,
  } as never).abortSignal(signal ?? new AbortController().signal);
  if (result.error) throw result.error;
  return result.data as unknown as MonthlyWorkshopOverheads;
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
    ["الإيراد المفوتر قبل الضريبة", cashSummary.invoiced_ex_vat || 0, insuranceSummary.invoiced_ex_vat || 0, Number(cashSummary.invoiced_ex_vat || 0) + Number(insuranceSummary.invoiced_ex_vat || 0)],
    ["الضريبة", cashSummary.vat || 0, insuranceSummary.vat || 0, Number(cashSummary.vat || 0) + Number(insuranceSummary.vat || 0)],
    ["المبلغ المحصل", cashSummary.collected || 0, insuranceSummary.collected || 0, Number(cashSummary.collected || 0) + Number(insuranceSummary.collected || 0)],
    ["التكلفة المباشرة", cashSummary.direct_cost || 0, insuranceSummary.direct_cost || 0, Number(cashSummary.direct_cost || 0) + Number(insuranceSummary.direct_cost || 0)],
    ["الربح المباشر", cashGross, insuranceGross, cashGross + insuranceGross],
    ["المصروفات العامة قبل الضريبة", "", "", overhead],
    ["صافي ربح/خسارة الشهر", "", "", cashGross + insuranceGross - overhead],
  ], [34, 18, 18, 18]), "الملخص");

  const vehicleHeaders = ["النوع","أمر العمل","المطالبة","العميل","الهاتف","اللوحة","الماركة","الموديل","الفواتير","قبل الضريبة","VAT","المحصل","المستحق","قطع الغيار","التكلفة المباشرة","الربح/الخسارة"];
  const vehicleData = (kind: string, rows: MonthlyVehicleProfitabilityRow[]) => rows.map((row) => [kind,row.work_order_number,row.claim_number,row.customer_name,row.customer_phone,`${row.plate_number || ""} ${row.plate_letters || ""}`.trim(),row.brand,row.model,row.invoice_numbers,row.invoiced_ex_vat,row.vat,row.collected,row.outstanding,row.parts_cost,row.direct_cost,row.gross_profit]);
  XLSX.utils.book_append_sheet(wb, sheet([vehicleHeaders,...vehicleData("كاش",cashRows),...vehicleData("تأمين",insuranceRows)], [12,18,22,28,16,16,16,18,24,16,14,16,16,16,18,18]), "ربحية السيارات");

  XLSX.utils.book_append_sheet(wb, sheet([["التاريخ","السند","القسم","التصنيف","الفرعي","المورد/المستفيد","البيان","قبل الضريبة","VAT","الإجمالي"],...overheads.expenseRows.map((row) => [row.date,row.voucher_number,row.department_ar,row.category_ar,row.subcategory_ar,row.supplier_name,row.description,row.subtotal,row.vat,row.total])], [14,18,20,24,24,24,36,16,14,16]), "المصروفات العامة");
  XLSX.utils.book_append_sheet(wb, sheet([["التاريخ","السند","الموظف/المستفيد","التصنيف","البيان","قبل الضريبة","VAT","الإجمالي"],...overheads.payrollRows.map((row) => [row.date,row.voucher_number,row.beneficiary || row.supplier_name,row.subcategory_ar || row.category_ar,row.description,row.subtotal,row.vat,row.total])], [14,18,26,24,36,16,14,16]), "الرواتب");

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
