import { printReportRows, type ReportExportRequest } from "@/lib/reports-center/reportExportService";
import {
  hrStore,
  type Attendance,
  type Employee,
  type Payslip,
} from "@/lib/hrStore";

export type EmployeeHrReportSection =
  | "all"
  | "profile"
  | "contract"
  | "salary"
  | "advances"
  | "adjustments"
  | "payslips"
  | "leaves"
  | "attendance"
  | "documents"
  | "performance";

type ExtractRow = Record<string, unknown> & {
  section: string;
  field: string;
  value: string | number;
  details: string;
};

const SECTION_NAMES: Record<Exclude<EmployeeHrReportSection, "all">, [string, string]> = {
  profile: ["الملف الشخصي", "Profile"],
  contract: ["العقد والوظيفة", "Contract & Employment"],
  salary: ["الراتب والمالية", "Salary & Finance"],
  advances: ["السلف", "Advances"],
  adjustments: ["الخصومات والمكافآت", "Deductions & Bonuses"],
  payslips: ["كشوف الرواتب", "Payslips"],
  leaves: ["الإجازات", "Leaves"],
  attendance: ["الحضور والغياب", "Attendance & Absence"],
  documents: ["المستندات", "Documents"],
  performance: ["الأداء", "Performance"],
};

const value = (input: unknown) => input === null || input === undefined || input === "" ? "—" : String(input);
const money = (input: unknown) => Number(input || 0).toFixed(3);
const join = (...inputs: unknown[]) => inputs.map(value).join(" | ");
const attendanceStatus = (status: string, isAr: boolean) => ({
  present: isAr ? "حضور" : "Present", absent: isAr ? "غياب" : "Absent", late: isAr ? "تأخير" : "Late",
  leave: isAr ? "إجازة" : "Leave", holiday: isAr ? "عطلة" : "Holiday",
}[status] || status);

function rowsFor(employee: Employee, section: Exclude<EmployeeHrReportSection, "all">, isAr: boolean): ExtractRow[] {
  const sectionName = SECTION_NAMES[section][isAr ? 0 : 1];
  const row = (fieldAr: string, fieldEn: string, fieldValue: unknown, details = ""): ExtractRow => ({
    section: sectionName,
    field: isAr ? fieldAr : fieldEn,
    value: value(fieldValue),
    details,
  });

  if (section === "profile") return [
    row("رقم الموظف", "Employee No.", employee.employeeNumber), row("الاسم", "Name", employee.name),
    row("الاسم بالإنجليزية", "English Name", employee.nameEn), row("الرقم المدني", "National ID", employee.nationalId),
    row("رقم الجواز", "Passport No.", employee.passportNo), row("الجنسية", "Nationality", employee.nationality),
    row("تاريخ الميلاد", "Date of Birth", employee.dateOfBirth), row("الهاتف", "Phone", employee.phone),
    row("هاتف الطوارئ", "Emergency Phone", employee.emergencyPhone), row("البريد الإلكتروني", "Email", employee.email),
    row("العنوان", "Address", employee.address),
  ];
  if (section === "contract") return [
    row("المسمى الوظيفي", "Position", employee.position), row("القسم", "Department", employee.department),
    row("الدور الوظيفي", "Job Role", employee.jobRole), row("نوع العقد", "Contract Type", employee.contractType),
    row("حالة الموظف", "Employment Status", employee.employmentStatus), row("تاريخ التعيين", "Hire Date", employee.hireDate),
    row("المدير المباشر", "Manager", employee.manager), row("بداية العقد", "Contract Start", employee.contractStartDate),
    row("نهاية العقد", "Contract End", employee.contractEndDate), row("ملاحظات", "Notes", employee.notes),
  ];
  if (section === "salary") {
    const allowances = Number(employee.housingAllowance || 0) + Number(employee.transportAllowance || 0) + Number(employee.otherAllowances || 0);
    return [
      row("الراتب الأساسي", "Base Salary", money(employee.baseSalary)), row("بدل السكن", "Housing Allowance", money(employee.housingAllowance)),
      row("بدل المواصلات", "Transport Allowance", money(employee.transportAllowance)), row("بدلات أخرى", "Other Allowances", money(employee.otherAllowances)),
      row("إجمالي الراتب", "Gross Salary", money(Number(employee.baseSalary || 0) + allowances)), row("اسم البنك", "Bank", employee.bankName),
      row("رقم الحساب", "Account No.", employee.bankAccount), row("IBAN", "IBAN", employee.iban),
    ];
  }
  if (section === "advances") return hrStore.listAdvances(employee.id).map((item) => row(
    item.date, item.date, money(item.amount),
    join(item.status, item.reason, `${isAr ? "المتبقي" : "Remaining"}: ${money(item.remainingAmount)}`),
  ));
  if (section === "adjustments") return [
    ...hrStore.listDeductions(employee.id).map((item) => row(item.date, item.date, `-${money(item.amount)}`, join(isAr ? "خصم" : "Deduction", item.type, item.reason))),
    ...hrStore.listBonuses(employee.id).map((item) => row(item.date, item.date, `+${money(item.amount)}`, join(isAr ? "مكافأة" : "Bonus", item.type, item.reason))),
  ];
  if (section === "payslips") return hrStore.listPayslips(employee.id).map((item) => row(
    item.month, item.month, money(item.netSalary),
    join(`${isAr ? "تاريخ الصرف" : "Payment date"}: ${value(item.paidAt?.slice(0, 10))}`, `${isAr ? "الأساسي" : "Base"}: ${money(item.baseSalary)}`, `${isAr ? "البدلات" : "Allowances"}: ${money(item.allowances)}`, `${isAr ? "المكافآت" : "Bonuses"}: ${money(item.bonuses)}`, `${isAr ? "الخصومات" : "Deductions"}: ${money(Number(item.deductions || 0) + Number(item.advanceDeduction || 0))}`),
  ));
  if (section === "leaves") return hrStore.listLeaves(employee.id).map((item) => row(
    `${item.startDate} — ${item.endDate}`, `${item.startDate} — ${item.endDate}`, item.days,
    join(item.type, item.status, item.reason),
  ));
  if (section === "attendance") return hrStore.listAttendance(employee.id).map((item) => row(
    item.date, item.date, attendanceStatus(item.status, isAr),
    join(`${isAr ? "الدخول" : "In"}: ${value(item.checkIn)}`, `${isAr ? "الخروج" : "Out"}: ${value(item.checkOut)}`, `${isAr ? "الساعات" : "Hours"}: ${value(item.hours)}`, item.notes),
  ));
  if (section === "documents") return hrStore.listDocuments(employee.id).map((item) => row(
    item.name, item.name, item.type,
    join(`${isAr ? "تاريخ الرفع" : "Uploaded"}: ${value(item.uploadedAt?.slice(0, 10))}`, `${isAr ? "الانتهاء" : "Expiry"}: ${value(item.expiryDate)}`, item.fileName),
  ));
  return hrStore.listReviews(employee.id).map((item) => row(
    item.period, item.period, `${Number(item.overall || 0).toFixed(1)} / 5`,
    join(item.date, item.reviewer, item.strengths, item.improvements),
  ));
}

export async function printEmployeeHrExtract(employee: Employee, section: EmployeeHrReportSection, isAr: boolean) {
  const sections = section === "all" ? Object.keys(SECTION_NAMES) as Exclude<EmployeeHrReportSection, "all">[] : [section];
  const rows = sections.flatMap((item) => rowsFor(employee, item, isAr));
  if (!rows.length) rows.push({ section: section === "all" ? (isAr ? "ملف الموظف" : "Employee File") : SECTION_NAMES[section][isAr ? 0 : 1], field: isAr ? "النتيجة" : "Result", value: isAr ? "لا توجد بيانات" : "No data", details: "" });
  const request: ReportExportRequest<ExtractRow> = {
    fileName: `Employee_${employee.employeeNumber}_${section}.pdf`,
    sheetName: "Employee",
    title: section === "all" ? (isAr ? "مستخرج ملف الموظف الكامل" : "Complete Employee File Extract") : SECTION_NAMES[section][isAr ? 0 : 1],
    filters: [{ label: isAr ? "الموظف" : "Employee", value: employee.name }, { label: isAr ? "رقم الموظف" : "Employee No.", value: employee.employeeNumber }],
    columns: [
      { key: "section", label: isAr ? "القسم" : "Section" }, { key: "field", label: isAr ? "البيان" : "Field" },
      { key: "value", label: isAr ? "القيمة" : "Value" }, { key: "details", label: isAr ? "التفاصيل" : "Details" },
    ],
    rows, language: isAr ? "ar" : "en",
  };
  await printReportRows(request);
}

export async function printPayslip(employee: Employee, payslip: Payslip, isAr: boolean) {
  const rows: ExtractRow[] = [
    { section: payslip.month, field: isAr ? "الراتب الأساسي" : "Base Salary", value: money(payslip.baseSalary), details: "" },
    { section: payslip.month, field: isAr ? "البدلات" : "Allowances", value: money(payslip.allowances), details: "" },
    { section: payslip.month, field: isAr ? "المكافآت والإضافي" : "Bonuses & Overtime", value: money(Number(payslip.bonuses || 0) + Number(payslip.overtimeAmount || 0)), details: "" },
    { section: payslip.month, field: isAr ? "الخصومات والسلف" : "Deductions & Advances", value: money(Number(payslip.deductions || 0) + Number(payslip.advanceDeduction || 0)), details: "" },
    { section: payslip.month, field: isAr ? "صافي الراتب" : "Net Salary", value: money(payslip.netSalary), details: payslip.notes || "" },
  ];
  await printReportRows({
    fileName: `Payslip_${employee.employeeNumber}_${payslip.month}.pdf`, sheetName: "Payslip",
    title: isAr ? "كشف راتب شهري" : "Monthly Payslip",
    filters: [{ label: isAr ? "الموظف" : "Employee", value: employee.name }, { label: isAr ? "الشهر" : "Month", value: payslip.month }, { label: isAr ? "تاريخ الصرف" : "Payment Date", value: payslip.paidAt?.slice(0, 10) || "—" }],
    columns: [{ key: "field", label: isAr ? "البيان" : "Item" }, { key: "value", label: isAr ? "المبلغ (ر.ع)" : "Amount (OMR)", type: "money" }, { key: "details", label: isAr ? "ملاحظات" : "Notes" }],
    rows, language: isAr ? "ar" : "en",
  });
}

export async function printAttendanceMonth(employee: Employee, month: string, records: Attendance[], isAr: boolean) {
  const totals = {
    present: records.filter((item) => item.status === "present").length,
    absent: records.filter((item) => item.status === "absent").length,
    late: records.filter((item) => item.status === "late").length,
    leave: records.filter((item) => item.status === "leave").length,
  };
  const rows = records.length ? records.map((item) => ({ ...item, status: attendanceStatus(item.status, isAr), checkIn: item.checkIn || "—", checkOut: item.checkOut || "—", hours: Number(item.hours || 0), overtimeHours: Number(item.overtimeHours || 0), notes: item.notes || "" })) : [{ date: "—", status: isAr ? "لا توجد سجلات" : "No records", checkIn: "—", checkOut: "—", hours: 0, overtimeHours: 0, notes: "" }];
  await printReportRows({
    fileName: `Attendance_${employee.employeeNumber}_${month}.pdf`, sheetName: "Attendance",
    title: isAr ? "تقرير الحضور والغياب الشهري" : "Monthly Attendance & Absence Report",
    filters: [
      { label: isAr ? "الموظف" : "Employee", value: employee.name }, { label: isAr ? "الشهر" : "Month", value: month },
      { label: isAr ? "حضور / تأخير / غياب / إجازة" : "Present / Late / Absent / Leave", value: `${totals.present} / ${totals.late} / ${totals.absent} / ${totals.leave}` },
    ],
    columns: [
      { key: "date", label: isAr ? "التاريخ" : "Date", type: "date" }, { key: "status", label: isAr ? "الحالة" : "Status" },
      { key: "checkIn", label: isAr ? "الدخول" : "Check-in" }, { key: "checkOut", label: isAr ? "الخروج" : "Check-out" },
      { key: "hours", label: isAr ? "الساعات" : "Hours", type: "number" }, { key: "overtimeHours", label: isAr ? "الإضافي" : "Overtime", type: "number" },
      { key: "notes", label: isAr ? "ملاحظات" : "Notes" },
    ],
    rows, language: isAr ? "ar" : "en",
  });
}
