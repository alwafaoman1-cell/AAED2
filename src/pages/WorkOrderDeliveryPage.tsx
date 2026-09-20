import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import VehicleDeliveryReceiptDialog from "@/components/workorders/VehicleDeliveryReceiptDialog";
import {
  fetchWorkOrderFromCloudByIdentifier,
  getWorkOrderById,
  type WorkOrder,
} from "@/lib/workOrdersStore";
import type { VehicleDeliveryReceiptDraft } from "@/lib/vehicleDeliveryReceipt";

interface DeliveryRouteState {
  returnTo?: string;
  deliveryDraft?: VehicleDeliveryReceiptDraft;
}

export default function WorkOrderDeliveryPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state || {}) as DeliveryRouteState;
  const [order, setOrder] = useState<WorkOrder | null>(() => getWorkOrderById(id));
  const [loading, setLoading] = useState(!order);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void fetchWorkOrderFromCloudByIdentifier(id)
      .then((result) => {
        if (!active) return;
        setOrder(result);
        if (!result) setError("أمر العمل غير موجود");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "تعذر تحميل أمر العمل");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [id]);

  const orderRoute = order
    ? `/work-orders/${encodeURIComponent(order.displayNumber || order.id)}`
    : "/work-orders";
  const returnTo = routeState.returnTo || orderRoute;

  if (loading) {
    return (
      <div className="flex min-h-[45vh] items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> تحميل نموذج خروج وتسليم المركبة…
      </div>
    );
  }

  if (!order || error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-destructive/30 bg-card p-6 text-center">
        <p className="font-semibold text-destructive">{error || "أمر العمل غير موجود"}</p>
        <Button variant="outline" onClick={() => navigate("/work-orders")}>
          <ArrowRight className="h-4 w-4" /> العودة إلى أوامر العمل
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-10">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => navigate(returnTo)} className="gap-2">
          <ArrowRight className="h-4 w-4" /> العودة إلى أمر العمل
        </Button>
      </div>

      <VehicleDeliveryReceiptDialog
        open
        presentation="page"
        onOpenChange={(nextOpen) => { if (!nextOpen) navigate(returnTo); }}
        order={order}
        deliveryDraft={routeState.deliveryDraft}
        onFinalized={() => {
          setOrder((current) => current ? { ...current, status: "تم التسليم" } : current);
        }}
      />
    </div>
  );
}
