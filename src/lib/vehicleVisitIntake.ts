/** A prepared inspection is not an arrival or an undocumented exit. This
 * marker is set only by the atomic intake RPC for new inspection visits. */
export function isVehicleVisitAwaitingArrival(entry: any): boolean {
  return entry?.vehicle_condition?.arrival_confirmation === "pending"
    && entry?.vehicle_condition?.visit_purpose === "inspection"
    && entry?.vehicle_location === "مع العميل";
}

export function newVehicleVisitLocation(purpose: "workshop" | "inspection" | null): string {
  return purpose === "inspection" ? "مع العميل" : "داخل الورشة";
}

/** An untouched minute-resolution picker means "now", not the start of that
 * minute (which may precede a just-confirmed approval). An edited time is kept. */
export function vehicleVisitActionTime(value:string,initialValue:string,now=new Date()):string{
  const date=value===initialValue?now:new Date(value);
  if(!value||!Number.isFinite(date.getTime()))throw new Error('VEHICLE_VISIT_TIME_INVALID');
  return date.toISOString();
}
