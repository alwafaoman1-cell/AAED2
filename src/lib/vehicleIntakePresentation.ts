import { toEnglishDigits } from "@/lib/formatters/numberFormat";

interface IntakePresentationSource {
  vehicle_snapshot?: { mileage?: unknown };
  vehicle_condition?: { review_return?: { mileage?: unknown } };
  vehicle_location?: unknown;
  vehicle_location_bay?: unknown;
}

function savedText(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

/** Present the supplied intake record, including an immutable signed snapshot.
 * Never fill historical gaps from the live vehicle, owner or workflow state. */
export function resolveVehicleIntakePresentation(entry: IntakePresentationSource, language: "ar" | "en") {
  const labels = language === "en"
    ? { missing: "Not recorded", inside: "In workshop", customer: "With customer" }
    : { missing: "غير موثّق", inside: "داخل الورشة", customer: "مع العميل" };
  const odometer = savedText(entry.vehicle_snapshot?.mileage)
    ?? savedText(entry.vehicle_condition?.review_return?.mileage);
  const recordedLocation = savedText(entry.vehicle_location);
  const locationKey = recordedLocation?.toLowerCase();
  const inside = locationKey === "داخل الورشة" || locationKey === "in_workshop" || locationKey === "in workshop";
  const withCustomer = locationKey === "مع العميل" || locationKey === "with_customer" || locationKey === "with customer";
  const location = inside ? labels.inside : withCustomer ? labels.customer : recordedLocation || labels.missing;
  // A leftover workshop bay must not imply workshop custody for a customer-held
  // vehicle or an old form whose custody location was never recorded.
  const bay = inside ? savedText(entry.vehicle_location_bay) : undefined;
  return {
    odometer: odometer === undefined ? labels.missing : toEnglishDigits(odometer),
    locationAtIntake: bay ? `${location} / ${bay}` : location,
  };
}
