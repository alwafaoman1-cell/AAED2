import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { customerPortalEntryForOrder } from "@/lib/customerPortalTokens";
import VehicleCustomerPortalPanel from "@/components/vehicle-entry/VehicleCustomerPortalPanel";
import { useAuth } from "@/contexts/AuthContext";

interface Props { jobOrderId: string; customerPhone?: string; orderNumber?: string; localOrderId?: string; customerName?: string }
export default function CustomerPortalLink({ jobOrderId, customerPhone }: Props) {
  const { i18n } = useTranslation(); const en = i18n.language.startsWith("en");
  const { profile } = useAuth(); const tenantId = profile?.tenant_id;
  const visit = useQuery({ queryKey: ["customer-portal-entry-for-order", tenantId, jobOrderId], queryFn: () => customerPortalEntryForOrder(jobOrderId), enabled: !!tenantId && !!jobOrderId, retry: false });
  if (visit.isLoading) return <p role="status">{en ? "Loading customer portal…" : "جارٍ تحميل بوابة العميل…"}</p>;
  if (!visit.data || visit.isError) return <p className="text-sm text-muted-foreground">{en ? "A confirmed vehicle intake visit is required before preparing the customer portal." : "يلزم سجل دخول مركبة موثّق قبل تجهيز بوابة العميل."}</p>;
  return <VehicleCustomerPortalPanel entryId={visit.data} customerPhone={customerPhone}/>;
}
