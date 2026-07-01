// نظام إدارة الموارد البشرية HR — تخزين محلي شامل
// عقود، رواتب، سلف، خصومات، إجازات، حضور، مكافآت، مستندات، تقييمات

import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "./cloudSettings";

export type EmploymentStatus = "active" | "on_leave" | "suspended" | "terminated";
export type ContractType = "full_time" | "part_time" | "contract" | "freelance";
export type LeaveType = "annual" | "sick" | "emergency" | "unpaid" | "maternity" | "other";
export type LeaveStatus = "pending" | "approved" | "rejected";
export type AdvanceStatus = "pending" | "approved" | "paid" | "deducted" | "rejected";
export type AttendanceStatus = "present" | "absent" | "late" | "leave" | "holiday";

export interface Employee {
  id: string;
  // البيانات الأساسية
  employeeNumber: string;             // EMP-0001
  name: string;
  nameEn?: string;
  nationalId?: string;                // الرقم المدني
  passportNo?: string;
  nationality?: string;
  dateOfBirth?: string;
  gender?: "male" | "female";
  maritalStatus?: "single" | "married" | "divorced" | "widowed";
  // الاتصال
  phone?: string;
  emergencyPhone?: string;
  email?: string;
  address?: string;
  // الوظيفة
  position: string;                   // المسمى الوظيفي
  department?: string;                // القسم
  jobRole?: string;                   // فني ميكانيكا، فني كهرباء، إداري...
  hireDate?: string;
  employmentStatus: EmploymentStatus;
  manager?: string;
  // العقد
  contractType?: ContractType;
  contractStartDate?: string;
  contractEndDate?: string;
  contractFileUrl?: string;
  // الراتب
  baseSalary: number;                 // الراتب الأساسي
  housingAllowance?: number;          // بدل سكن
  transportAllowance?: number;        // بدل مواصلات
  otherAllowances?: number;           // بدلات أخرى
  // البنك
  bankName?: string;
  bankAccount?: string;
  iban?: string;
  // ملاحظات
  notes?: string;
  avatarUrl?: string;
  // أداء (محسوب من أوامر العمل)
  rating?: number;
  // تواريخ النظام
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface Advance {
  id: string;
  employeeId: string;
  date: string;
  amount: number;
  reason?: string;
  status: AdvanceStatus;
  installments: number;               // عدد الأقساط
  monthlyDeduction?: number;          // الخصم الشهري
  remainingAmount: number;
  notes?: string;
  approvedBy?: string;
  createdAt: string;
}

export interface Deduction {
  id: string;
  employeeId: string;
  date: string;
  amount: number;
  reason: string;                      // غياب / تأخير / مخالفة / سلفة
  type: "absence" | "late" | "violation" | "advance_repayment" | "other";
  notes?: string;
  createdAt: string;
}

export interface Bonus {
  id: string;
  employeeId: string;
  date: string;
  amount: number;
  reason: string;
  type: "performance" | "overtime" | "commission" | "festival" | "other";
  notes?: string;
  createdAt: string;
}

export interface Leave {
  id: string;
  employeeId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  status: LeaveStatus;
  approvedBy?: string;
  notes?: string;
  createdAt: string;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string;                        // YYYY-MM-DD
  checkIn?: string;                    // HH:mm
  checkOut?: string;
  status: AttendanceStatus;
  hours?: number;
  overtimeHours?: number;
  notes?: string;
  createdAt: string;
}

export interface Payslip {
  id: string;
  employeeId: string;
  month: string;                        // YYYY-MM
  baseSalary: number;
  allowances: number;
  bonuses: number;
  overtimeAmount: number;
  deductions: number;
  advanceDeduction: number;
  socialInsurance?: number;
  netSalary: number;
  paidAt?: string;
  paymentMethod?: string;
  notes?: string;
  createdAt: string;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  name: string;
  type: "id" | "passport" | "contract" | "certificate" | "license" | "other";
  fileUrl?: string;                     // base64 dataUrl للتخزين المحلي
  fileName?: string;
  fileSize?: number;
  expiryDate?: string;
  notes?: string;
  uploadedAt: string;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  date: string;
  period: string;                       // الربع/السنة
  ratings: {
    quality: number;
    speed: number;
    teamwork: number;
    discipline: number;
    initiative: number;
  };
  overall: number;
  strengths?: string;
  improvements?: string;
  reviewer?: string;
  createdAt: string;
}

interface HRDB {
  employees: Employee[];
  advances: Advance[];
  deductions: Deduction[];
  bonuses: Bonus[];
  leaves: Leave[];
  attendance: Attendance[];
  payslips: Payslip[];
  documents: EmployeeDocument[];
  reviews: PerformanceReview[];
}

const KEY = "alwafa_hr_v1";
const subs = new Set<() => void>();
let cache: HRDB | null = null;

function read(): HRDB {
  if (cache) return cache;
  cache = empty();
  void readCloudSetting<HRDB>(KEY, empty()).then((value) => {
    cache = { ...empty(), ...value };
    subs.forEach((cb) => cb());
  }).catch(() => undefined);
  return cache!;
}
function empty(): HRDB {
  return { employees: [], advances: [], deductions: [], bonuses: [], leaves: [], attendance: [], payslips: [], documents: [], reviews: [] };
}
function write(next: HRDB) {
  cache = next;
  subs.forEach((cb) => cb());
  void writeCloudSetting(KEY, next).catch((error) => {
    console.warn("[hrStore] Supabase write failed", error);
  });
}

if (typeof window !== "undefined") {
  subscribeCloudSetting<HRDB>(KEY, (value) => {
    cache = { ...empty(), ...value };
    subs.forEach((cb) => cb());
  });
}
function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function nowIso() { return new Date().toISOString(); }

export const hrStore = {
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },

  // Employees
  listEmployees(): Employee[] {
    return read().employees.filter((e) => !e.isDeleted).sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber));
  },
  getEmployee(id: string) { return read().employees.find((e) => e.id === id); },
  nextEmployeeNumber(): string {
    const all = read().employees;
    const max = all.reduce((m, e) => {
      const n = parseInt((e.employeeNumber || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return `EMP-${String(max + 1).padStart(4, "0")}`;
  },
  saveEmployee(e: Employee) {
    const db = read();
    const idx = db.employees.findIndex((x) => x.id === e.id);
    const final = { ...e, updatedAt: nowIso() };
    if (idx >= 0) db.employees[idx] = final; else db.employees.unshift(final);
    write({ ...db });
    return final;
  },
  removeEmployee(id: string) {
    const db = read();
    db.employees = db.employees.map((e) => e.id === id ? { ...e, isDeleted: true } : e);
    write({ ...db });
  },

  // Advances
  listAdvances(employeeId?: string) {
    const all = read().advances;
    return (employeeId ? all.filter((a) => a.employeeId === employeeId) : all)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveAdvance(a: Advance) {
    const db = read();
    const idx = db.advances.findIndex((x) => x.id === a.id);
    if (idx >= 0) db.advances[idx] = a; else db.advances.unshift(a);
    write({ ...db });
    return a;
  },
  removeAdvance(id: string) {
    const db = read();
    db.advances = db.advances.filter((a) => a.id !== id);
    write({ ...db });
  },

  // Deductions
  listDeductions(employeeId?: string) {
    const all = read().deductions;
    return (employeeId ? all.filter((d) => d.employeeId === employeeId) : all)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveDeduction(d: Deduction) {
    const db = read();
    const idx = db.deductions.findIndex((x) => x.id === d.id);
    if (idx >= 0) db.deductions[idx] = d; else db.deductions.unshift(d);
    write({ ...db });
    return d;
  },
  removeDeduction(id: string) {
    const db = read();
    db.deductions = db.deductions.filter((d) => d.id !== id);
    write({ ...db });
  },

  // Bonuses
  listBonuses(employeeId?: string) {
    const all = read().bonuses;
    return (employeeId ? all.filter((b) => b.employeeId === employeeId) : all)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveBonus(b: Bonus) {
    const db = read();
    const idx = db.bonuses.findIndex((x) => x.id === b.id);
    if (idx >= 0) db.bonuses[idx] = b; else db.bonuses.unshift(b);
    write({ ...db });
    return b;
  },
  removeBonus(id: string) {
    const db = read();
    db.bonuses = db.bonuses.filter((b) => b.id !== id);
    write({ ...db });
  },

  // Leaves
  listLeaves(employeeId?: string) {
    const all = read().leaves;
    return (employeeId ? all.filter((l) => l.employeeId === employeeId) : all)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  },
  saveLeave(l: Leave) {
    const db = read();
    const idx = db.leaves.findIndex((x) => x.id === l.id);
    if (idx >= 0) db.leaves[idx] = l; else db.leaves.unshift(l);
    write({ ...db });
    return l;
  },
  removeLeave(id: string) {
    const db = read();
    db.leaves = db.leaves.filter((l) => l.id !== id);
    write({ ...db });
  },

  // Attendance
  listAttendance(employeeId?: string, month?: string) {
    let all = read().attendance;
    if (employeeId) all = all.filter((a) => a.employeeId === employeeId);
    if (month) all = all.filter((a) => a.date.startsWith(month));
    return all.sort((a, b) => b.date.localeCompare(a.date));
  },
  saveAttendance(a: Attendance) {
    const db = read();
    const idx = db.attendance.findIndex((x) => x.id === a.id);
    if (idx >= 0) db.attendance[idx] = a; else db.attendance.unshift(a);
    write({ ...db });
    return a;
  },
  removeAttendance(id: string) {
    const db = read();
    db.attendance = db.attendance.filter((a) => a.id !== id);
    write({ ...db });
  },

  // Payslips
  listPayslips(employeeId?: string) {
    const all = read().payslips;
    return (employeeId ? all.filter((p) => p.employeeId === employeeId) : all)
      .sort((a, b) => b.month.localeCompare(a.month));
  },
  savePayslip(p: Payslip) {
    const db = read();
    const idx = db.payslips.findIndex((x) => x.id === p.id);
    if (idx >= 0) db.payslips[idx] = p; else db.payslips.unshift(p);
    write({ ...db });
    return p;
  },
  removePayslip(id: string) {
    const db = read();
    db.payslips = db.payslips.filter((p) => p.id !== id);
    write({ ...db });
  },

  // Documents
  listDocuments(employeeId: string) {
    return read().documents.filter((d) => d.employeeId === employeeId)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },
  saveDocument(d: EmployeeDocument) {
    const db = read();
    const idx = db.documents.findIndex((x) => x.id === d.id);
    if (idx >= 0) db.documents[idx] = d; else db.documents.unshift(d);
    write({ ...db });
    return d;
  },
  removeDocument(id: string) {
    const db = read();
    db.documents = db.documents.filter((d) => d.id !== id);
    write({ ...db });
  },

  // Performance Reviews
  listReviews(employeeId?: string) {
    const all = read().reviews;
    return (employeeId ? all.filter((r) => r.employeeId === employeeId) : all)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveReview(r: PerformanceReview) {
    const db = read();
    const idx = db.reviews.findIndex((x) => x.id === r.id);
    if (idx >= 0) db.reviews[idx] = r; else db.reviews.unshift(r);
    write({ ...db });
    return r;
  },

  // Helpers
  uid,
  nowIso,

  // Computed: ملخص مالي للموظف
  summary(employeeId: string, monthYYYYMM?: string) {
    const month = monthYYYYMM || new Date().toISOString().slice(0, 7);
    const advs = read().advances.filter((a) => a.employeeId === employeeId);
    const dedsM = read().deductions.filter((d) => d.employeeId === employeeId && d.date.startsWith(month));
    const bonM = read().bonuses.filter((b) => b.employeeId === employeeId && b.date.startsWith(month));
    const advMonthly = advs.filter((a) => a.status === "approved" || a.status === "paid")
      .reduce((s, a) => s + (a.monthlyDeduction || 0), 0);
    const totalRemainingAdv = advs.reduce((s, a) => s + (a.remainingAmount || 0), 0);
    const monthDeductions = dedsM.reduce((s, d) => s + d.amount, 0);
    const monthBonuses = bonM.reduce((s, b) => s + b.amount, 0);
    return {
      month,
      monthBonuses,
      monthDeductions,
      advanceMonthlyRepay: advMonthly,
      totalAdvancesOutstanding: totalRemainingAdv,
    };
  },
};

export const HR_DEPARTMENTS_AR = [
  "الإدارة", "الميكانيكا", "الكهرباء", "الحوادث والسمكرة", "الدهان", "الكشف والبرمجة",
  "المخزون والمشتريات", "المحاسبة", "خدمة العملاء", "السائقين والمناولة",
];

export const HR_POSITIONS_AR = [
  "مدير عام", "مدير تشغيل", "محاسب", "أمين صندوق", "أمين مخزون", "موظف خدمة عملاء",
  "فني أول", "فني", "مساعد فني", "سائق", "عامل نظافة",
];
