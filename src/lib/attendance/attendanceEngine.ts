/** SmartPSS exports local wall-clock time. Oman has a fixed UTC+04:00 offset. */
export const WORKSHOP_TIME_ZONE = "Asia/Muscat";
export const WORKSHOP_SHIFT = { morningStart: 8 * 60, morningEnd: 13 * 60, afternoonStart: 16 * 60, afternoonEnd: 21 * 60 } as const;
export const WORKSHOP_BREAK = { start: WORKSHOP_SHIFT.morningEnd, end: WORKSHOP_SHIFT.afternoonStart } as const;

export interface DevicePunch {
  personId: string;
  personName: string;
  deviceKey: string;
  occurredAt: string;
  eventCode: number;
}

export interface ParsedAttendanceFile {
  punches: DevicePunch[];
  rejected: number;
  duplicates: number;
}

const arabicDigits = /[٠-٩۰-۹]/g;
const toAscii = (value: string) => value.replace(arabicDigits, (digit) => {
  const code = digit.charCodeAt(0);
  return String(code <= 0x0669 ? code - 0x0660 : code - 0x06f0);
});

export function parseSmartPssRows(rows: unknown[][]): ParsedAttendanceFile {
  if (!rows.length) throw new Error("ATTENDANCE_EMPTY_FILE");
  const headers = rows[0].map((value) => String(value ?? "").trim().toLowerCase());
  const column = (name: string) => headers.indexOf(name);
  const time = column("time");
  const person = column("person id");
  const name = column("name");
  const point = column("attendance point");
  const event = column("attendance event");
  if ([time, person, name, point, event].some((index) => index < 0)) throw new Error("ATTENDANCE_INVALID_HEADER");

  const punches: DevicePunch[] = [];
  const keys = new Set<string>();
  let rejected = 0;
  let duplicates = 0;
  for (const row of rows.slice(1)) {
    if (!row.some((value) => value !== null && value !== undefined && value !== "")) continue;
    const local = toAscii(String(row[time] ?? "").trim());
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(local);
    const personId = toAscii(String(row[person] ?? "").trim());
    const deviceKey = String(row[point] ?? "").trim();
    const codeMatch = /\[(\d+)\]/.exec(String(row[event] ?? ""));
    if (!match || !personId || !deviceKey || !codeMatch || !/^[0-4]$/.test(codeMatch[1])) { rejected++; continue; }
    const [, year, month, day, hour, minute, second] = match;
    const stamp = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}+04:00`;
    const parsed = new Date(stamp);
    const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (Number(year) < 2020 || Number(year) > 2100 || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      !Number.isFinite(parsed.getTime()) || calendar.getUTCFullYear() !== Number(year) ||
      calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day)) {
      rejected++; continue;
    }
    const key = [deviceKey, personId, stamp, codeMatch[1]].join("|");
    if (keys.has(key)) { duplicates++; continue; }
    keys.add(key);
    punches.push({ personId, personName: String(row[name] ?? "").trim(), deviceKey, occurredAt: stamp, eventCode: Number(codeMatch[1]) });
  }
  return { punches, rejected, duplicates };
}

const minutes = (stamp: string) => Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16));
const overlap = (start: number, end: number, windowStart: number, windowEnd: number) =>
  Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));

export type PeriodStatus = "present" | "absent" | "incomplete" | "excused" | "pending" | "rest";
export interface AttendancePeriod {
  status: PeriodStatus;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
  workedMinutes: number;
  shortfallMinutes: number;
}
export interface AttendanceDayReview {
  morning_status: Exclude<PeriodStatus, "pending" | "rest">;
  afternoon_status: Exclude<PeriodStatus, "pending" | "rest">;
  morning_in: string | null;
  morning_out: string | null;
  afternoon_in: string | null;
  afternoon_out: string | null;
}

export interface AttendanceDay {
  date: string;
  firstPunch: string | null;
  lastPunch: string | null;
  checkout: string | null;
  checkoutEstimated: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  workedMinutes: number;
  lateMinutes: number;
  shortfallMinutes: number;
  punchCount: number;
  morning: AttendancePeriod;
  afternoon: AttendancePeriod;
  breakOut: string | null;
  breakIn: string | null;
  reviewed: boolean;
}

function localToday(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: WORKSHOP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

export function isCompletedAttendanceDate(date: string, now = new Date()): boolean {
  const today = localToday(now);
  return date < today.date || (date === today.date && today.minute >= WORKSHOP_SHIFT.afternoonEnd);
}

const stampFor = (date: string, clock: string | null) => clock ? `${date}T${clock.slice(0, 5)}:00+04:00` : null;
const statusFor = (hasEvidence: boolean, complete: boolean, ended: boolean, rest: boolean, covered: boolean): PeriodStatus =>
  rest ? "rest" : !hasEvidence ? !ended ? "pending" : covered ? "absent" : "incomplete" : complete ? "present" : "incomplete";

function period(status: PeriodStatus, checkIn: string | null, checkOut: string | null, start: number, end: number, graceMinutes: number): AttendancePeriod {
  const inMinute = checkIn ? minutes(checkIn) : null;
  const outMinute = checkOut ? minutes(checkOut) : null;
  const complete = status === "present" && inMinute !== null && outMinute !== null && outMinute > inMinute;
  const workedMinutes = complete ? overlap(inMinute, outMinute, start, end) : 0;
  const startDelay = inMinute === null ? 0 : Math.max(0, Math.min(inMinute, end) - start);
  const lateMinutes = status === "present" || status === "incomplete"
    ? Math.max(0, startDelay - graceMinutes) : 0;
  return { status, checkIn, checkOut, workedMinutes, lateMinutes,
    shortfallMinutes: status === "absent" ? end - start
      : complete ? Math.max(0, end - start - workedMinutes - Math.min(graceMinutes, startDelay)) : 0 };
}

/** Raw device punches remain immutable; a reviewed correction is a separate audit record. */
export function deriveAttendanceDay(punches: DevicePunch[], date: string, now = new Date(), graceMinutes = 0, review?: AttendanceDayReview, covered = false): AttendanceDay | null {
  const dayPunches = punches.filter((row) => row.occurredAt.slice(0, 10) === date)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (!dayPunches.length && !review && !covered) return null;
  const ended = isCompletedAttendanceDate(date, now);
  const restDay = new Date(`${date}T00:00:00Z`).getUTCDay() === 5;
  // SmartPSS code 0 is generic: use the shift windows and require two distinct
  // punches before calling a period complete. An evening punch never fills a missing break.
  const morningRows = dayPunches.filter((row) => minutes(row.occurredAt) < 14 * 60 + 30);
  const afternoonRows = dayPunches.filter((row) => minutes(row.occurredAt) >= 14 * 60 + 30);
  const morningIn = morningRows.find((row) => row.eventCode !== 3 && row.eventCode !== 4 && minutes(row.occurredAt) < 11 * 60)?.occurredAt ?? null;
  const morningOut = [...morningRows].reverse().find((row) =>
    row.occurredAt !== morningIn && (minutes(row.occurredAt) >= 11 * 60 || row.eventCode === 3 || row.eventCode === 4))?.occurredAt ?? null;
  const afternoonIn = afternoonRows.find((row) => row.eventCode !== 4 && minutes(row.occurredAt) < 19 * 60)?.occurredAt ?? null;
  const afternoonOut = [...afternoonRows].reverse().find((row) =>
    row.occurredAt !== afternoonIn && (minutes(row.occurredAt) >= 19 * 60 || row.eventCode === 4))?.occurredAt ?? null;
  const morningStatus = review?.morning_status ?? statusFor(morningRows.length > 0, !!(morningIn && morningOut), ended, restDay, covered);
  const afternoonStatus = review?.afternoon_status ?? statusFor(afternoonRows.length > 0, !!(afternoonIn && afternoonOut), ended, restDay, covered);
  const morning = period(morningStatus, review ? stampFor(date, review.morning_in) : morningIn,
    review ? stampFor(date, review.morning_out) : morningOut, WORKSHOP_SHIFT.morningStart, WORKSHOP_SHIFT.morningEnd, graceMinutes);
  const afternoon = period(afternoonStatus, review ? stampFor(date, review.afternoon_in) : afternoonIn,
    review ? stampFor(date, review.afternoon_out) : afternoonOut, WORKSHOP_SHIFT.afternoonStart, WORKSHOP_SHIFT.afternoonEnd, graceMinutes);
  const estimated = !review && !restDay && ended && !!afternoon.checkIn && !afternoon.checkOut;
  const checkout = afternoon.checkOut ?? (estimated ? `${date}T21:00:00+04:00` : null);
  const reviewReasons: string[] = [];
  if (restDay) reviewReasons.push("friday_rest_day_punch");
  if (estimated) reviewReasons.push("estimated_checkout");
  if (!review && (morningStatus === "incomplete" || afternoonStatus === "incomplete")) reviewReasons.push("incomplete_period");
  if (!review && (morningStatus === "absent" || afternoonStatus === "absent")) reviewReasons.push("absence_from_device_record");
  if (!review && !dayPunches.length && covered) reviewReasons.push("no_punch_in_confirmed_coverage");
  return {
    date, firstPunch: dayPunches[0]?.occurredAt ?? null, lastPunch: dayPunches.at(-1)?.occurredAt ?? null, checkout,
    checkoutEstimated: estimated, needsReview: reviewReasons.length > 0, reviewReasons,
    workedMinutes: morning.workedMinutes + afternoon.workedMinutes,
    lateMinutes: morning.lateMinutes + afternoon.lateMinutes,
    shortfallMinutes: morning.shortfallMinutes + afternoon.shortfallMinutes,
    punchCount: dayPunches.length, morning, afternoon,
    breakOut: morning.checkOut, breakIn: afternoon.checkIn, reviewed: !!review,
  };
}
