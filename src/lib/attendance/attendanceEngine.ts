/** SmartPSS exports local wall-clock time. Oman has a fixed UTC+04:00 offset. */
export const WORKSHOP_TIME_ZONE = "Asia/Muscat";
export const WORKSHOP_SHIFT = { morningStart: 8 * 60, morningEnd: 13 * 60, afternoonStart: 16 * 60, afternoonEnd: 21 * 60 } as const;

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

export interface AttendanceDay {
  date: string;
  firstPunch: string;
  lastPunch: string | null;
  checkout: string | null;
  checkoutEstimated: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  workedMinutes: number;
  lateMinutes: number;
  shortfallMinutes: number;
  punchCount: number;
}

/** A device event is never altered. 21:00 is a display-only estimate, not a biometric event. */
export function deriveAttendanceDay(punches: DevicePunch[], date: string, now = new Date()): AttendanceDay | null {
  const dayPunches = punches.filter((row) => row.occurredAt.slice(0, 10) === date)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  if (!dayPunches.length) return null;
  const first = dayPunches[0];
  const last = dayPunches[dayPunches.length - 1];
  const nowLocal = new Intl.DateTimeFormat("en-CA", { timeZone: WORKSHOP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => nowLocal.find((item) => item.type === type)?.value ?? "";
  const currentDate = `${part("year")}-${part("month")}-${part("day")}`;
  const currentMinute = Number(part("hour")) * 60 + Number(part("minute"));
  const ended = date < currentDate || (date === currentDate && currentMinute >= WORKSHOP_SHIFT.afternoonEnd);
  const restDay = new Date(`${date}T00:00:00Z`).getUTCDay() === 5;

  const explicitCheckout = [...dayPunches].reverse().find((row) => row.eventCode === 4);
  const reliableLast = dayPunches.length > 1 && minutes(last.occurredAt) >= 20 * 60 + 30;
  const estimated = !restDay && !explicitCheckout && !reliableLast && ended && minutes(last.occurredAt) < WORKSHOP_SHIFT.afternoonEnd;
  const checkout = explicitCheckout?.occurredAt ?? (estimated ? `${date}T21:00:00+04:00` : reliableLast ? last.occurredAt : null);
  const firstMinute = minutes(first.occurredAt);
  const endMinute = checkout ? minutes(checkout) : firstMinute;
  const workedMinutes = checkout
    ? overlap(firstMinute, endMinute, WORKSHOP_SHIFT.morningStart, WORKSHOP_SHIFT.morningEnd)
      + overlap(firstMinute, endMinute, WORKSHOP_SHIFT.afternoonStart, WORKSHOP_SHIFT.afternoonEnd)
    : 0;
  const hasMorning = dayPunches.some((row) => minutes(row.occurredAt) < WORKSHOP_SHIFT.morningEnd);
  const afternoonArrival = dayPunches.find((row) => row.eventCode === 3 && minutes(row.occurredAt) >= WORKSHOP_SHIFT.morningEnd);
  const lateMinutes = restDay ? 0 : (hasMorning ? Math.max(0, Math.min(firstMinute, WORKSHOP_SHIFT.morningEnd) - WORKSHOP_SHIFT.morningStart) : 0)
    + (afternoonArrival ? Math.max(0, Math.min(minutes(afternoonArrival.occurredAt), WORKSHOP_SHIFT.afternoonEnd) - WORKSHOP_SHIFT.afternoonStart) : 0);
  const reviewReasons: string[] = [];
  if (restDay) reviewReasons.push("friday_rest_day_punch");
  if (estimated) reviewReasons.push("estimated_checkout");
  if (!checkout) reviewReasons.push("open_day_or_missing_checkout");
  if (!hasMorning && !restDay) reviewReasons.push("missing_morning");
  if (dayPunches.length === 1) reviewReasons.push("single_punch");
  if (firstMinute >= WORKSHOP_SHIFT.morningEnd && !estimated && !restDay) reviewReasons.push("ambiguous_first_punch");
  if (checkout && endMinute < WORKSHOP_SHIFT.afternoonEnd && !restDay) reviewReasons.push("early_checkout");
  return {
    date, firstPunch: first.occurredAt, lastPunch: last.occurredAt, checkout,
    checkoutEstimated: estimated, needsReview: reviewReasons.length > 0, reviewReasons,
    workedMinutes, lateMinutes, shortfallMinutes: restDay ? 0 : checkout ? Math.max(0, 600 - workedMinutes) : 0,
    punchCount: dayPunches.length,
  };
}
