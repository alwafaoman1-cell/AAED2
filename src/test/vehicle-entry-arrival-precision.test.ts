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
  it("can print observed seconds without exposing database fractional precision", () => {
    expect(vehicleEntryArrivalTime({ arrival_time: "18:37:42.872092" }, "en", "second")).toBe("18:37:42");
    expect(vehicleEntryArrivalTime(entry, "en", "second")).toBe("Time not recorded");
    expect(vehicleEntryArrivalTime({}, "en", "second")).toBe("");
  });
  it("does not invent a missing clock", () => expect(vehicleEntryArrivalTime({}, "en")).toBe(""));
});
