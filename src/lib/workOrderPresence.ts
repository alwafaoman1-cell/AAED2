/** The staff apps must not show a vehicle as being in the workshop after its location changes. */
export function isWorkOrderInWorkshop(order: {
  status: string;
  vehiclePresenceStatus?: string | null;
}): boolean {
  return !["تم التسليم", "مغلق", "delivered", "closed"].includes(order.status)
    && order.vehiclePresenceStatus !== "with_customer";
}
