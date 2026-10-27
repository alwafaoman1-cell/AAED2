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

  it("estimates a missing checkout at 21:00 without inventing a raw event", () => {
    const original = [punch("08:05:00", 1)];
    const result = deriveAttendanceDay(original, "2026-10-24", new Date("2026-10-25T08:00:00Z"));
    expect(result?.checkout).toBe("2026-10-24T21:00:00+04:00");
    expect(result?.checkoutEstimated).toBe(true);
    expect(result?.needsReview).toBe(true);
    expect(result?.lateMinutes).toBe(5);
    expect(result?.workedMinutes).toBe(595);
    expect(original).toHaveLength(1);
  });

  it("never closes today's open day before 21:00", () => {
    const result = deriveAttendanceDay([punch("08:00:00", 1)], "2026-10-24", new Date("2026-10-24T11:00:00Z"));
    expect(result?.checkout).toBeNull();
    expect(result?.workedMinutes).toBe(0);
  });

  it("keeps an explicit checkout rather than the estimate", () => {
    const result = deriveAttendanceDay([punch("08:00:00", 1), punch("20:55:00", 4)], "2026-10-24", new Date("2026-10-25T08:00:00Z"));
    expect(result?.checkout).toBe("2026-10-24T20:55:00+04:00");
    expect(result?.checkoutEstimated).toBe(false);
    expect(result?.workedMinutes).toBe(595);
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
