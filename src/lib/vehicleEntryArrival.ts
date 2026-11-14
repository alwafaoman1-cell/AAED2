import i18n from "@/i18n";

i18n.addResourceBundle("ar", "vehicleEntryArrival", { unknownTime: "الوقت غير موثّق" }, true, true);
i18n.addResourceBundle("en", "vehicleEntryArrival", { unknownTime: "Time not recorded" }, true, true);

type Arrival = { arrival_time?: unknown; vehicle_condition?: { arrival_time_precision?: unknown } };

/** Retain the legacy clock for audit, never present it as an observed arrival. */
export function vehicleEntryArrivalTime(entry: Arrival, language = i18n.language, precision: "minute" | "second" = "minute"): string {
  return entry.vehicle_condition?.arrival_time_precision === "date_only"
    ? i18n.getFixedT(language, "vehicleEntryArrival")("unknownTime")
    : String(entry.arrival_time || "").slice(0, precision === "second" ? 8 : 5);
}
