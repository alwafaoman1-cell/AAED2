import { useNavigate, useSearchParams } from "react-router-dom";
import { smartBack } from "@/lib/smartBack";
import { ArrowRight, ShieldCheck, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import InsuranceInspectionDialog from "@/components/inspection/InsuranceInspectionDialog";

export default function InsuranceInspectionPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const wo = params.get("wo") || undefined;
  const editId = params.get("edit") || undefined;

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {editId ? <Pencil className="text-warning shrink-0" size={22} /> : <ShieldCheck className="text-info shrink-0" size={22} />}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground truncate">
              {editId ? `تعديل تقرير فحص التأمين — ${editId}` : "تقرير فحص أضرار للتأمين"}
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              {editId ? "Edit Insurance Damage Inspection" : "Insurance Damage Inspection — Al Madina Takaful Style"}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => smartBack(navigate, "/inspection")} className="gap-1">
          <ArrowRight size={16} /> رجوع
        </Button>
      </div>

      <InsuranceInspectionDialog
        asPage
        open={true}
        onOpenChange={(o) => { if (!o) navigate("/inspection"); }}
        preselectOrderId={wo}
        editId={editId}
      />
    </div>
  );
}
