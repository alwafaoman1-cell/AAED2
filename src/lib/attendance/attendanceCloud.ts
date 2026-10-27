import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { hrStore } from "@/lib/hrStore";
import { isCompletedAttendanceDate, type AttendanceDayReview, type DevicePunch } from "./attendanceEngine";
import type { Database } from "@/integrations/supabase/types";

export type MonthReview = Database["public"]["Tables"]["hr_attendance_month_reviews"]["Row"];
export type DayReview = Database["public"]["Tables"]["hr_attendance_day_reviews"]["Row"];

export interface DevicePersonMapping {
  id: string;
  device_key: string;
  person_id: string;
  employee_id: string;
}

async function requireTenant(): Promise<string> {
  const tenant = await getCurrentTenantId();
  if (!tenant) throw new Error("ATTENDANCE_TENANT_REQUIRED");
  return tenant;
}

export async function loadDevicePeople(): Promise<DevicePersonMapping[]> {
  const tenant = await requireTenant();
  const { data, error } = await supabase.from("hr_attendance_device_people")
    .select("id,device_key,person_id,employee_id").eq("tenant_id", tenant).order("person_id");
  if (error) throw error;
  return data ?? [];
}

export async function saveDevicePerson(deviceKey: string, personId: string, employeeId: string): Promise<void> {
  const employee = hrStore.getEmployee(employeeId);
  if (!employee || employee.isDeleted) throw new Error("ATTENDANCE_EMPLOYEE_NOT_FOUND");
  const tenant = await requireTenant();
  const { data: existing, error: existingError } = await supabase.from("hr_attendance_device_people")
    .select("id,employee_id").eq("tenant_id", tenant).eq("device_key", deviceKey).eq("person_id", personId).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.employee_id === employeeId) return;
  if (existing) {
    const { count, error: countError } = await supabase.from("hr_attendance_punches")
      .select("id", { count: "exact", head: true }).eq("tenant_id", tenant)
      .eq("device_key", deviceKey).eq("person_id", personId);
    if (countError) throw countError;
    if (count) throw new Error("ATTENDANCE_MAPPING_HAS_HISTORY");
    const { data: saved, error } = await supabase.from("hr_attendance_device_people")
      .update({ employee_id: employeeId }).eq("tenant_id", tenant).eq("id", existing.id)
      .eq("employee_id", existing.employee_id).select("employee_id").single();
    if (error || saved?.employee_id !== employeeId) throw error || new Error("ATTENDANCE_MAPPING_NOT_SAVED");
    return;
  }
  const { data: saved, error } = await supabase.from("hr_attendance_device_people")
    .insert({ tenant_id: tenant, device_key: deviceKey, person_id: personId, employee_id: employeeId }).select("employee_id").single();
  if (error || saved?.employee_id !== employeeId) throw error || new Error("ATTENDANCE_MAPPING_NOT_SAVED");
}

export async function importDevicePunches(punches: DevicePunch[], mappings: DevicePersonMapping[]): Promise<{ submitted: number; inserted: number; unmapped: number }> {
  const tenant = await requireTenant();
  const map = new Map(mappings.map((row) => [`${row.device_key}|${row.person_id}`, row.employee_id]));
  const valid = punches.flatMap((row) => {
    const employeeId = map.get(`${row.deviceKey}|${row.personId}`);
    if (!employeeId || !hrStore.getEmployee(employeeId) || hrStore.getEmployee(employeeId)?.isDeleted) return [];
    return [{ tenant_id: tenant, device_key: row.deviceKey, person_id: row.personId, employee_id: employeeId,
      occurred_at: row.occurredAt, event_code: row.eventCode, source: "smartpss_xlsx" }];
  });
  if (valid.length !== punches.length) return { submitted: 0, inserted: 0, unmapped: punches.length - valid.length };
  let inserted = 0;
  for (let index = 0; index < valid.length; index += 200) {
    const { data, error } = await supabase.from("hr_attendance_punches")
      .upsert(valid.slice(index, index + 200), {
        onConflict: "tenant_id,device_key,person_id,occurred_at,event_code", ignoreDuplicates: true,
      }).select("id");
    if (error) throw error;
    inserted += data?.length ?? 0;
  }
  return { submitted: valid.length, inserted, unmapped: 0 };
}

export async function loadEmployeePunches(employeeId: string, month: string): Promise<DevicePunch[]> {
  const tenant = await requireTenant();
  const [year, number] = month.split("-").map(Number);
  if (!year || !number || number < 1 || number > 12) throw new Error("ATTENDANCE_INVALID_MONTH");
  const end = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
  const { data, error } = await supabase.from("hr_attendance_punches")
    .select("device_key,person_id,occurred_at,event_code")
    .eq("tenant_id", tenant).eq("employee_id", employeeId)
    .gte("occurred_at", `${month}-01T00:00:00+04:00`)
    .lt("occurred_at", `${end}-01T00:00:00+04:00`)
    .order("occurred_at", { ascending: true }).limit(2000);
  if (error) throw error;
  if ((data?.length ?? 0) >= 2000) throw new Error("ATTENDANCE_MONTH_LIMIT_EXCEEDED");
  return (data ?? []).map((row) => ({ deviceKey: row.device_key, personId: row.person_id,
    personName: "", occurredAt: new Date(row.occurred_at).toLocaleString("sv-SE", { timeZone: "Asia/Muscat", hour12: false }).replace(" ", "T") + "+04:00",
    eventCode: row.event_code }));
}

function monthEnd(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("ATTENDANCE_INVALID_MONTH");
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}

export async function loadAttendanceReviews(employeeId: string, month: string): Promise<{ monthReview: MonthReview | null; dayReviews: DayReview[] }> {
  const tenant = await requireTenant();
  const end = monthEnd(month);
  const [monthly, daily] = await Promise.all([
    supabase.from("hr_attendance_month_reviews").select("*").eq("tenant_id", tenant).eq("employee_id", employeeId)
      .eq("month", `${month}-01`).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(2),
    supabase.from("hr_attendance_day_reviews").select("*").eq("tenant_id", tenant).eq("employee_id", employeeId)
      .gte("attendance_date", `${month}-01`).lt("attendance_date", `${end}-01`)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1001),
  ]);
  if (monthly.error || daily.error) throw monthly.error || daily.error;
  if ((daily.data?.length ?? 0) > 1000) throw new Error("ATTENDANCE_REVIEW_LIMIT_EXCEEDED");
  return { monthReview: monthly.data?.[0] ?? null, dayReviews: daily.data ?? [] };
}

async function verifyEmployee(employeeId: string): Promise<string> {
  if (!hrStore.getEmployee(employeeId) || hrStore.getEmployee(employeeId)?.isDeleted) throw new Error("ATTENDANCE_EMPLOYEE_NOT_FOUND");
  return requireTenant();
}

export async function saveMonthReview(employeeId: string, month: string, coverageStart: string, coverageEnd: string, graceMinutes: number, reason: string): Promise<MonthReview> {
  monthEnd(month);
  if (!coverageStart.startsWith(month) || !coverageEnd.startsWith(month) || coverageStart > coverageEnd ||
      !isCompletedAttendanceDate(coverageEnd) || !Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 60 || reason.trim().length < 8) {
    throw new Error("ATTENDANCE_INVALID_COVERAGE");
  }
  const tenant = await verifyEmployee(employeeId);
  const { data, error } = await supabase.from("hr_attendance_month_reviews").insert({ tenant_id: tenant, employee_id: employeeId,
    month: `${month}-01`, coverage_start: coverageStart, coverage_end: coverageEnd,
    grace_minutes: graceMinutes, reason: reason.trim() }).select("*").single();
  if (error || !data) throw error || new Error("ATTENDANCE_REVIEW_NOT_SAVED");
  return data;
}

export async function saveDayReview(employeeId: string, date: string, review: AttendanceDayReview, reason: string): Promise<DayReview> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isCompletedAttendanceDate(date) || reason.trim().length < 8) throw new Error("ATTENDANCE_INVALID_REVIEW");
  for (const key of ["morning", "afternoon"] as const) {
    const state = review[`${key}_status`];
    const input = review[`${key}_in`];
    const output = review[`${key}_out`];
    if (state === "present" ? !input || !output || !/^\d{2}:\d{2}$/.test(input) || !/^\d{2}:\d{2}$/.test(output) || output <= input
      : !!input || !!output) throw new Error("ATTENDANCE_INVALID_REVIEW_TIMES");
  }
  const tenant = await verifyEmployee(employeeId);
  const { data, error } = await supabase.from("hr_attendance_day_reviews").insert({ tenant_id: tenant, employee_id: employeeId,
    attendance_date: date, ...review, reason: reason.trim() }).select("*").single();
  if (error || !data) throw error || new Error("ATTENDANCE_REVIEW_NOT_SAVED");
  return data;
}
