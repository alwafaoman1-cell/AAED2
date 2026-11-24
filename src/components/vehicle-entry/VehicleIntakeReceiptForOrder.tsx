import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { loadVehicleDeliveryVisitId } from "@/lib/vehicleDeliveryReceipt";
import VehicleIntakeReceiptCheck from "./VehicleIntakeReceiptCheck";
export default function VehicleIntakeReceiptForOrder({ orderId, orderNumber, receiptId, legacyReason, workflowRequirementOverrideId, readOnly, onChange }: {
  orderId: string; orderNumber?: string; receiptId?: string | null; legacyReason?: string | null; readOnly: boolean;
  workflowRequirementOverrideId?: string | null;
  onChange: (id: string | null, reason: string) => void;
}) {
  const { i18n } = useTranslation();
  const entry = useQuery({ queryKey: ["handover-intake-visit", orderId], queryFn: () => loadVehicleDeliveryVisitId({ id: orderId, orderNumber }) });
  if (entry.isLoading) return <p role="status">{i18n.language.startsWith("en") ? "Loading intake visit…" : "جارٍ تحميل زيارة الدخول…"}</p>;
  if (entry.error || !entry.data) return <p role="alert" className="text-destructive">{i18n.language.startsWith("en") ? "A valid visit link is required before delivery." : "يلزم ربط زيارة دخول صحيحة قبل التسليم."}</p>;
  return <VehicleIntakeReceiptCheck entryId={entry.data} receiptId={receiptId} legacyReason={legacyReason} workflowRequirementOverrideId={workflowRequirementOverrideId} readOnly={readOnly} onChange={onChange} />;
}
