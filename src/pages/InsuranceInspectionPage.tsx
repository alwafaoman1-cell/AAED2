import { useNavigate, useSearchParams } from "react-router-dom";
import { smartBack } from "@/lib/smartBack";
import { ArrowRight, ShieldCheck, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import InsuranceInspectionDialog from "@/components/inspection/InsuranceInspectionDialog";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { loadVehicleEntryInspection } from "@/lib/vehicleEntryInspection";
import "@/i18n/vehicleEntryInspection";

export default function InsuranceInspectionPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const wo = params.get("wo") || undefined;
  const editId = params.get("edit") || undefined;
  const entryId = params.get("entry");
  const { profile } = useAuth();
  const { t, i18n } = useTranslation("vehicleEntryInspection");
  const context = useQuery({
    queryKey: ["vehicle_entry_inspection", profile?.tenant_id, entryId],
    queryFn: () => loadVehicleEntryInspection(entryId!),
    enabled: Boolean(entryId && profile?.tenant_id), retry: false, staleTime: 0,
    refetchOnWindowFocus: false,
  });
  if (entryId) return <div className="space-y-4 pb-24" dir={i18n.dir()}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <Button variant="outline" onClick={() => navigate("/vehicle-entry")}>{t("back")}</Button>
    </div>
    {!context.data && !context.error && <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("loading")}</p>}
    {context.error && <div role="alert" className="space-y-3 rounded-lg border border-destructive p-4">
      <p>{t("unavailable")}</p><Button variant="outline" onClick={() => void context.refetch()}>{t("retry")}</Button>
    </div>}
    {context.data && !context.error && <>
      <p className="text-sm text-muted-foreground">{t("linkHint")}</p>
      <p className="text-sm" dir="auto">{t("linkedTo", { entry: context.data.entryNumber, claim: context.data.meta.claimNo })}</p>
      <InsuranceInspectionDialog key={`${entryId}:${context.data.existingCode || "new"}`} asPage open
        onOpenChange={(open) => { if (!open) navigate(`/insurance/${context.data.claimId}`); }} entryContext={context.data} />
    </>}
  </div>;

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
