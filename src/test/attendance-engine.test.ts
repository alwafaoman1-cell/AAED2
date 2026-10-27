import { describe, expect, it } from "vitest";
import { deriveAttendanceDay, parseSmartPssRows, type DevicePunch } from "@/lib/attendance/attendanceEngine";

const punch = (at: string, eventCode = 0): DevicePunch => ({
  personId: "7", personName: "Aqeel", deviceKey: "TEMO Attendance", occurredAt: `2026-10-24T${at}+04:00`, eventCode,
});

describe("SmartPSS attendance", () => {
  it("parses Arabic digits and rejects duplicates or impossible dates", () => {
    const result = parseSmartPssRows([
      ["Time", "Person ID", "Name", "Department", "Attendance Point", "Attendance Event"],
      ["٢٠٢٦-١٠-٢٤ ٠٨:٠١:٠٠", "٧", "Aqeel", "", "TEMO Attendance", "Check In[1]"],
      ["٢٠٢٦-١٠-٢٤ ٠٨:٠١:٠٠", "٧", "Aqeel", "", "TEMO Attendance", "Check In[1]"],
      ["2026-02-30 08:00:00", "7", "Aqeel", "", "TEMO Attendance", "Check In[1]"],
    ]);
    expect(result).toMatchObject({ rejected: 1, duplicates: 1 });
    expect(result.punches[0]).toMatchObject({ personId: "7", occurredAt: "2026-10-24T08:01:00+04:00", eventCode: 1 });
  });

  it("does not turn one morning punch into a full worked day", () => {
    const original = [punch("08:05:00", 1)];
    const result = deriveAttendanceDay(original, "2026-10-24", new Date("2026-10-25T08:00:00Z"));
    expect(result?.checkout).toBeNull();
    expect(result?.checkoutEstimated).toBe(false);
    expect(result?.needsReview).toBe(true);
    expect(result?.lateMinutes).toBe(5);
    expect(result?.workedMinutes).toBe(0);
    expect(result?.morning.status).toBe("incomplete");
    expect(result?.afternoon.status).toBe("incomplete");
    expect(original).toHaveLength(1);
  });

  it("never closes today's open day before 21:00", () => {
    const result = deriveAttendanceDay([punch("08:00:00", 1)], "2026-10-24", new Date("2026-10-24T11:00:00Z"));
    expect(result?.checkout).toBeNull();
    expect(result?.workedMinutes).toBe(0);
  });

  it("does not infer break punches or worked hours from an entry and final exit", () => {
    const result = deriveAttendanceDay([punch("08:00:00", 1), punch("20:55:00", 4)], "2026-10-24", new Date("2026-10-25T08:00:00Z"));
    expect(result?.checkout).toBe("2026-10-24T20:55:00+04:00");
    expect(result?.checkoutEstimated).toBe(false);
    expect(result?.workedMinutes).toBe(0);
    expect(result?.breakOut).toBeNull();
    expect(result?.breakIn).toBeNull();
  });

  it("reads generic SmartPSS events in both shifts and applies grace", () => {
    const rows = [punch("08:18:00"), punch("13:12:00", 3), punch("16:15:00"), punch("21:21:00", 4)];
    const result = deriveAttendanceDay(rows, "2026-10-24", new Date("2026-10-25T08:00:00Z"), 10);
    expect(result?.breakOut).toContain("13:12");
    expect(result?.breakIn).toContain("16:15");
    expect(result?.workedMinutes).toBe(567);
    expect(result?.lateMinutes).toBe(13);
    expect(result?.shortfallMinutes).toBe(13);
    expect(result?.morning.status).toBe("present");
    expect(result?.afternoon.status).toBe("present");
  });

  it("classifies only a missing evening period as half-day record absence", () => {
    const result = deriveAttendanceDay([punch("08:18:00"), punch("13:09:00", 3)], "2026-10-24", new Date("2026-10-25T08:00:00Z"), 0, undefined, true);
    expect(result?.morning.status).toBe("present");
    expect(result?.afternoon.status).toBe("absent");
    expect(result?.shortfallMinutes).toBe(318);
  });

  it("never infers full absence before month coverage is confirmed", () => {
    const now = new Date("2026-10-25T08:00:00Z");
    expect(deriveAttendanceDay([], "2026-10-24", now)).toBeNull();
    const covered = deriveAttendanceDay([], "2026-10-24", now, 0, undefined, true);
    expect(covered?.morning.status).toBe("absent");
    expect(covered?.afternoon.status).toBe("absent");
    expect(covered?.shortfallMinutes).toBe(600);
  });

  it("shows 21:00 only as an estimate when there is an afternoon entry", () => {
    const result = deriveAttendanceDay([punch("16:08:00")], "2026-10-24", new Date("2026-10-25T08:00:00Z"), 0, undefined, true);
    expect(result?.checkout).toContain("21:00");
    expect(result?.checkoutEstimated).toBe(true);
    expect(result?.workedMinutes).toBe(0);
    expect(result?.morning.status).toBe("absent");
  });

  it("uses reviewed corrections without changing raw punches", () => {
    const raw = [punch("08:05:00")];
    const result = deriveAttendanceDay(raw, "2026-10-24", new Date("2026-10-25T08:00:00Z"), 0,
      { morning_status: "present", afternoon_status: "present", morning_in: "08:05", morning_out: "13:00", afternoon_in: "16:00", afternoon_out: "21:00" });
    expect(result?.workedMinutes).toBe(595);
    expect(result?.reviewed).toBe(true);
    expect(raw).toHaveLength(1);
  });

  it("does not classify a Friday punch as lateness or estimate a checkout", () => {
    const friday: DevicePunch = { ...punch("09:00:00", 1), occurredAt: "2026-10-23T09:00:00+04:00" };
    const result = deriveAttendanceDay([friday], "2026-10-23", new Date("2026-10-25T08:00:00Z"));
    expect(result?.lateMinutes).toBe(0);
    expect(result?.shortfallMinutes).toBe(0);
    expect(result?.checkoutEstimated).toBe(false);
    expect(result?.reviewReasons).toContain("friday_rest_day_punch");
  });
});
