/** Legacy free text is never interpreted as proof that a vehicle runs. */
export type VehicleRunningStatus = "running" | "not_running" | "unknown";

export function vehicleRunningStatus(value: unknown): VehicleRunningStatus {
  return value === "running" || value === "not_running" ? value : "unknown";
}

export function vehicleRunningStatusLabel(value: unknown, language: string): string {
  const english = language.startsWith("en");
  const status = vehicleRunningStatus(value);
  return status === "running" ? (english ? "Vehicle runs" : "المركبة تعمل")
    : status === "not_running" ? (english ? "Vehicle does not run" : "المركبة لا تعمل")
      : (english ? "Not recorded / not checked" : "غير مسجل / لم يتم الفحص");
}

export function parseVehicleOdometer(value: string): number | null {
  const digits = value.trim().replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0));
  return /^\d{1,8}$/.test(digits) ? Number(digits) : null;
}

export function needsRunningStatusBeforeIssue(form: { id?: unknown; status?: string; condition?: { running_status?: unknown } }, targetStatus = form.status): boolean {
  return targetStatus !== "Draft" && (!form.id || form.status === "Draft")
    && vehicleRunningStatus(form.condition?.running_status) === "unknown";
}
