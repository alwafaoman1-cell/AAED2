import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import WorkOrderForm from "@/components/workorders/WorkOrderForm";

export default function WorkOrderNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as {
    prefillCustomer?: string;
    prefillPhone?: string;
    prefillPlate?: string;
    prefillVehicle?: unknown;
    prefillVisit?: unknown;
  };
  return (
    <div className="min-h-screen bg-background p-4 md:p-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground">إنشاء أمر عمل جديد</h1>
            <p className="text-sm text-muted-foreground">عبّئ بيانات المركبة والاستلام ثم احفظ.</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/work-orders")} className="gap-1">
            <ArrowRight size={16} /> رجوع لقائمة الأوامر
          </Button>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 md:p-6">
          <WorkOrderForm
            onClose={() => navigate("/work-orders")}
            prefillCustomer={state.prefillCustomer}
            prefillPhone={state.prefillPhone}
            prefillPlate={state.prefillPlate}
            prefillVehicle={state.prefillVehicle}
            prefillVisit={state.prefillVisit}
          />
        </div>
      </div>
    </div>
  );
}
