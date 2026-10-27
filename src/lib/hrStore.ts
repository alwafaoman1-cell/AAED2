// نظام إدارة الموارد البشرية HR — الحفظ المؤكد في إعدادات المستأجر السحابية
// عقود، رواتب، سلف، خصومات، إجازات، حضور، مكافآت، مستندات، تقييمات

import {
  getCloudSettingsScopeVersion,
  mutateCloudObjectSetting,
  readCloudSettingFresh,
  subscribeCloudSetting,
  subscribeCloudSettingsScopeChange,
} from "./cloudSettings";
import { getCurrentTenantId } from "./cloud/createCloudStore";

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
  source?: "attendance";
  sourceMonth?: string;
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedAt?: string;
  approvedBy?: string;
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
  paidAmount?: number;                 // Optional: legacy paidAt alone is not proof of an amount.
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
  fileUrl?: string;                     // Legacy base64 data URL; retained for old records.
  storagePath?: string;                 // New uploads live in private HR Storage.
  deletedAt?: string;                   // Retain path until private-object cleanup succeeds.
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
let loadState: "idle" | "loading" | "ready" | "error" = "idle";

function read(): HRDB {
  if (cache) return cache;
  cache = empty();
  loadState = "loading";
  const scopeVersion = getCloudSettingsScopeVersion();
  void (async () => {
    if (!await getCurrentTenantId()) throw new Error("no_tenant");
    return readCloudSettingFresh<HRDB>(KEY, empty());
  })().then((value) => {
    if (scopeVersion !== getCloudSettingsScopeVersion()) return;
    cache = { ...empty(), ...value };
    loadState = "ready";
    notify();
  }).catch((error) => {
    if (scopeVersion !== getCloudSettingsScopeVersion()) return;
    loadState = "error";
    console.error("[hrStore] cloud read failed", error);
    notify();
  });
  return cache!;
}
function empty(): HRDB {
  return { employees: [], advances: [], deductions: [], bonuses: [], leaves: [], attendance: [], payslips: [], documents: [], reviews: [] };
}
function notify() {
  subs.forEach((cb) => cb());
}
async function updateHr(mutate: (db: HRDB) => HRDB): Promise<HRDB> {
  const next = await mutateCloudObjectSetting(KEY, empty(),
    (value) => mutate({ ...empty(), ...value }), getCloudSettingsScopeVersion());
  cache = next;
  loadState = "ready";
  notify();
  return next;
}
async function saveInCollection<T extends { id: string }>(collection: keyof HRDB, item: T): Promise<T> {
  await updateHr((db) => {
    const rows = db[collection] as unknown as T[];
    return {
      ...db,
      [collection]: rows.some((row) => row.id === item.id)
        ? rows.map((row) => row.id === item.id ? item : row)
        : [item, ...rows],
    };
  });
  return item;
}
async function removeFromCollection(collection: keyof HRDB, id: string): Promise<void> {
  await updateHr((db) => {
    const rows = db[collection] as { id: string }[];
    if (!rows.some((row) => row.id === id)) throw new Error("HR_RECORD_NOT_FOUND");
    return { ...db, [collection]: rows.filter((row) => row.id !== id) };
  });
}

if (typeof window !== "undefined") {
  subscribeCloudSetting<HRDB>(KEY, (value) => {
    cache = { ...empty(), ...value };
    loadState = "ready";
    notify();
  });
  subscribeCloudSettingsScopeChange(() => {
    cache = null;
    loadState = "idle";
    notify();
  });
}
function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function nowIso() { return new Date().toISOString(); }

export const hrStore = {
  subscribe(cb: () => void) { subs.add(cb); return () => subs.delete(cb); },
  loadState() { read(); return loadState; },
  retryLoad() { cache = null; loadState = "idle"; read(); notify(); },

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
  async saveEmployee(e: Employee): Promise<Employee> {
    const next = await updateHr((db) => {
      const idx = db.employees.findIndex((x) => x.id === e.id);
      if (idx >= 0 && db.employees[idx].updatedAt !== e.updatedAt) {
        throw new Error("HR_RECORD_CONFLICT");
      }
      const previousTime = idx >= 0 ? Date.parse(db.employees[idx].updatedAt) : NaN;
      const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(previousTime) ? previousTime + 1 : 0)).toISOString();
      const final = { ...e, updatedAt };
      if (idx < 0) {
        const max = db.employees.reduce((highest, row) => {
          const n = Number.parseInt((row.employeeNumber || "").replace(/\D/g, ""), 10);
          return Number.isFinite(n) ? Math.max(highest, n) : highest;
        }, 0);
        final.employeeNumber = `EMP-${String(max + 1).padStart(4, "0")}`;
      }
      return { ...db, employees: idx >= 0
        ? db.employees.map((row) => row.id === e.id ? final : row)
        : [final, ...db.employees] };
    });
    return next.employees.find((row) => row.id === e.id)!;
  },
  async removeEmployee(id: string): Promise<void> {
    await updateHr((db) => {
      if (!db.employees.some((e) => e.id === id)) throw new Error("HR_RECORD_NOT_FOUND");
      return { ...db, employees: db.employees.map((e) => e.id === id ? { ...e, isDeleted: true } : e) };
    });
  },

  // Advances
  listAdvances(employeeId?: string) {
    const all = read().advances;
    return (employeeId ? all.filter((a) => a.employeeId === employeeId) : [...all])
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveAdvance(a: Advance) { return saveInCollection("advances", a); },
  removeAdvance(id: string) { return removeFromCollection("advances", id); },

  // Deductions
  listDeductions(employeeId?: string) {
    const all = read().deductions;
    return (employeeId ? all.filter((d) => d.employeeId === employeeId) : [...all])
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveDeduction(d: Deduction) { return saveInCollection("deductions", d); },
  async removeDeduction(id: string) {
    await updateHr((db) => {
      const row = db.deductions.find((item) => item.id === id);
      if (!row) throw new Error("HR_RECORD_NOT_FOUND");
      if (row.source === "attendance") throw new Error("ATTENDANCE_SETTLEMENT_IMMUTABLE");
      return { ...db, deductions: db.deductions.filter((item) => item.id !== id) };
    });
  },
  listAttendanceSettlements(employeeId: string, month?: string) {
    return read().deductions.filter((row) => row.employeeId === employeeId && row.source === "attendance" && (!month || row.sourceMonth === month));
  },
  async proposeAttendanceDeduction(employeeId: string, month: string, amount: number, reason: string, type: "late" | "absence" | "other" = "late") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isFinite(amount) || amount <= 0 || !reason.trim()) {
      throw new Error("ATTENDANCE_INVALID_PROPOSAL");
    }
    const roundedAmount = Math.round(amount * 1000) / 1000;
    if (roundedAmount <= 0) throw new Error("ATTENDANCE_INVALID_PROPOSAL");
    const next = await updateHr((db) => {
      if (!db.employees.some((row) => row.id === employeeId && !row.isDeleted)) throw new Error("HR_RECORD_NOT_FOUND");
      const prior = db.deductions.find((row) => row.employeeId === employeeId && row.source === "attendance" && row.sourceMonth === month && row.approvalStatus !== "rejected");
      if (prior?.approvalStatus === "approved") throw new Error("ATTENDANCE_SETTLEMENT_ALREADY_APPROVED");
      if (prior) throw new Error("ATTENDANCE_SETTLEMENT_PENDING");
      const proposal: Deduction = {
        id: uid(), employeeId, date: `${month}-01`, amount: roundedAmount,
        reason: reason.trim(), type, source: "attendance", sourceMonth: month,
        approvalStatus: "pending", createdAt: nowIso(),
      };
      // Rejected decisions remain immutable evidence when a new proposal is submitted.
      return { ...db, deductions: [proposal, ...db.deductions] };
    });
    return next.deductions.find((row) => row.employeeId === employeeId && row.source === "attendance" && row.sourceMonth === month && row.approvalStatus === "pending")!;
  },
  async decideAttendanceDeduction(id: string, decision: "approved" | "rejected", approvedBy: string) {
    if (!approvedBy) throw new Error("ATTENDANCE_APPROVER_REQUIRED");
    await updateHr((db) => {
      const row = db.deductions.find((item) => item.id === id && item.source === "attendance");
      if (!row || row.approvalStatus !== "pending") throw new Error("ATTENDANCE_PROPOSAL_NOT_PENDING");
      if (decision === "approved" && db.payslips.some((slip) => slip.employeeId === row.employeeId && slip.month === row.sourceMonth && (slip.paidAt || (slip.paidAmount || 0) > 0))) {
        throw new Error("ATTENDANCE_PAYSLIP_ALREADY_PAID");
      }
      return { ...db, deductions: db.deductions.map((item) => item.id === id
        ? { ...item, approvalStatus: decision, approvedBy, approvedAt: nowIso() } : item) };
    });
  },

  // Bonuses
  listBonuses(employeeId?: string) {
    const all = read().bonuses;
    return (employeeId ? all.filter((b) => b.employeeId === employeeId) : [...all])
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveBonus(b: Bonus) { return saveInCollection("bonuses", b); },
  removeBonus(id: string) { return removeFromCollection("bonuses", id); },

  // Leaves
  listLeaves(employeeId?: string) {
    const all = read().leaves;
    return (employeeId ? all.filter((l) => l.employeeId === employeeId) : [...all])
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  },
  saveLeave(l: Leave) { return saveInCollection("leaves", l); },
  removeLeave(id: string) { return removeFromCollection("leaves", id); },

  // Attendance
  listAttendance(employeeId?: string, month?: string) {
    let all = read().attendance;
    if (employeeId) all = all.filter((a) => a.employeeId === employeeId);
    if (month) all = all.filter((a) => a.date.startsWith(month));
    return [...all].sort((a, b) => b.date.localeCompare(a.date));
  },
  saveAttendance(a: Attendance) { return saveInCollection("attendance", a); },
  removeAttendance(id: string) { return removeFromCollection("attendance", id); },

  // Payslips
  listPayslips(employeeId?: string) {
    const all = read().payslips;
    return (employeeId ? all.filter((p) => p.employeeId === employeeId) : [...all])
      .sort((a, b) => b.month.localeCompare(a.month));
  },
  savePayslip(p: Payslip) { return saveInCollection("payslips", p); },
  removePayslip(id: string) { return removeFromCollection("payslips", id); },

  // Documents
  listDocuments(employeeId: string) {
    return read().documents.filter((d) => d.employeeId === employeeId && !d.deletedAt)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },
  pendingDocumentCleanup(employeeId: string) {
    return read().documents.filter((d) => d.employeeId === employeeId && !!d.deletedAt && !!d.storagePath);
  },
  saveDocument(d: EmployeeDocument) { return saveInCollection("documents", d); },
  async removeDocument(id: string): Promise<void> {
    await updateHr((db) => {
      const document = db.documents.find((row) => row.id === id);
      if (!document) throw new Error("HR_RECORD_NOT_FOUND");
      return { ...db, documents: document.storagePath
        ? db.documents.map((row) => row.id === id ? { ...row, deletedAt: row.deletedAt || nowIso() } : row)
        : db.documents.filter((row) => row.id !== id) };
    });
  },
  async finishDocumentCleanup(id: string): Promise<void> {
    await updateHr((db) => {
      const document = db.documents.find((row) => row.id === id);
      if (!document) return db;
      if (!document.deletedAt || !document.storagePath) throw new Error("HR_DOCUMENT_NOT_PENDING_DELETE");
      return { ...db, documents: db.documents.filter((row) => row.id !== id) };
    });
  },

  // Performance Reviews
  listReviews(employeeId?: string) {
    const all = read().reviews;
    return (employeeId ? all.filter((r) => r.employeeId === employeeId) : [...all])
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  saveReview(r: PerformanceReview) { return saveInCollection("reviews", r); },

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
    const monthDeductions = dedsM.filter((d) => d.approvalStatus === undefined || d.approvalStatus === "approved")
      .reduce((s, d) => s + d.amount, 0);
    const proposedAttendanceDeductions = dedsM.filter((d) => d.source === "attendance" && d.approvalStatus === "pending")
      .reduce((s, d) => s + d.amount, 0);
    const monthBonuses = bonM.reduce((s, b) => s + b.amount, 0);
    return {
      month,
      monthBonuses,
      monthDeductions,
      proposedAttendanceDeductions,
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
