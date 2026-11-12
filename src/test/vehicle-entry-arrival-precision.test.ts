import { describe, expect, it } from "vitest";
import { vehicleEntryArrivalTime } from "@/lib/vehicleEntryArrival";

describe("confirmed historical arrival with unknown clock", () => {
  const entry = { arrival_time: "11:10:00", vehicle_condition: { arrival_time_precision: "date_only" } };
  it("never turns the entry creation clock into actual arrival", () => {
    expect(vehicleEntryArrivalTime(entry, "en")).toBe("Time not recorded");
    expect(vehicleEntryArrivalTime(entry, "ar")).toBe("الوقت غير موثّق");
    expect(entry.arrival_time).toBe("11:10:00");
  });
  it("preserves observed arrival clocks", () => {
    expect(vehicleEntryArrivalTime({ arrival_time: "08:42:17" }, "en")).toBe("08:42");
    expect(vehicleEntryArrivalTime({ ...entry, vehicle_condition: { arrival_time_precision: "minute" } }, "en")).toBe("11:10");
  });
  it("does not invent a missing clock", () => expect(vehicleEntryArrivalTime({}, "en")).toBe(""));
});
