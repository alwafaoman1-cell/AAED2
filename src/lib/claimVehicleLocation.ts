import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";

export type ClaimVehicleLocation =
  | "with_customer"
  | "in_workshop"
  | "delivered"
  | "paid_archive"
  | "cancelled";

export const claimVehicleLocationLabels: Record<ClaimVehicleLocation, string> = {
  with_customer: "مع العميل",
  in_workshop: "وصلت إلى الورشة",
  delivered: "تم التسليم",
  paid_archive: "أرشيف المدفوع",
  cancelled: "ملغاة / مرفوضة",
};

export function getClaimVehicleLocation(claim: InsuranceClaim): ClaimVehicleLocation {
  if (claim.status === "paid") return "paid_archive";
  if (claim.status === "cancelled" || claim.status === "rejected") return "cancelled";
  if (claim.delivered_at) return "delivered";
  if (claim.workshop_arrival_date) return "in_workshop";
  return "with_customer";
}

export function isActiveClaim(claim: InsuranceClaim): boolean {
  const location = getClaimVehicleLocation(claim);
  return location !== "paid_archive" && location !== "cancelled";
}

export function claimVehicleLocationClass(location: ClaimVehicleLocation): string {
  switch (location) {
    case "with_customer":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300";
    case "in_workshop":
      return "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300";
    case "delivered":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300";
    case "paid_archive":
      return "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300";
    case "cancelled":
      return "bg-muted text-muted-foreground border-border";
  }
}
