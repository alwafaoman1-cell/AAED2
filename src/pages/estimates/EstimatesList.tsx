import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, Search, ShieldCheck, Wrench, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatOMR } from "@/lib/money";
import {
  ESTIMATE_STATUS_LABEL,
  ESTIMATE_TYPE_LABEL,
  listUnifiedEstimates,
  type EstimateStatus,
  type EstimateType,
} from "@/lib/unifiedEstimates";

const typeIcon: Record<EstimateType, typeof Wrench> = {
  independent: Wrench,
  insurance: ShieldCheck,
  supplementary: FilePlus2,
};

export default function EstimatesList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const typeParam = searchParams.get("type");
  const initialType: "all" | EstimateType =
    typeParam === "independent" || typeParam === "insurance" || typeParam === "supplementary"
      ? typeParam
      : "all";
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | EstimateType>(initialType);
  const [status, setStatus] = useState<"all" | EstimateStatus>("all");
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["unified-estimates"],
    queryFn: listUnifiedEstimates,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((estimate) => {
      if (type !== "all" && estimate.estimate_type !== type) return false;
      if (status !== "all" && estimate.status !== status) return false;
      if (!q) return true;
      return [
        estimate.estimate_number,
        estimate.customer?.customer_code,
        estimate.customer?.name,
        estimate.customer?.phone,
        estimate.vehicle?.plate_number,
        estimate.vehicle?.vin,
        estimate.claim?.claim_number,
        estimate.work_order?.order_number,
        estimate.claim?.insurance_company,
      ].some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [data, search, status, type]);

  const totals = useMemo(() => ({
    all: data.length,
    independent: data.filter((e) => e.estimate_type === "independent").length,
    insurance: data.filter((e) => e.estimate_type === "insurance").length,
    supplementary: data.filter((e) => e.estimate_type === "supplementary").length,
  }), [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="text-primary" />
            التقديرات الموحدة
          </h1>
          <p className="text-sm text-muted-foreground">
            محرك واحد للتقديرات المستقلة، تقديرات التأمين، والتقديرات الإضافية.
          </p>
        </div>
        <Button onClick={() => navigate("/estimates/new")} className="gap-2">
          <Plus size={16} /> تقدير جديد
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">الكل</p><p className="text-2xl font-bold">{totals.all}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">مستقلة</p><p className="text-2xl font-bold">{totals.independent}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">تأمين</p><p className="text-2xl font-bold">{totals.insurance}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">إضافية</p><p className="text-2xl font-bold">{totals.supplementary}</p></Card>
      </div>

      <Card className="p-3 grid grid-cols-1 md:grid-cols-[1fr_180px_180px] gap-2">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <Input
            className="pr-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث برقم التقدير، العميل، اللوحة، VIN، المطالبة، أمر العمل..."
          />
        </div>
        <Select value={type} onValueChange={(v) => setType(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="independent">Independent</SelectItem>
            <SelectItem value="insurance">Insurance</SelectItem>
            <SelectItem value="supplementary">Supplementary</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as any)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(ESTIMATE_STATUS_LABEL).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label.ar}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">جاري تحميل التقديرات...</Card>
      ) : error ? (
        <Card className="p-8 text-center text-destructive">{(error as Error).message}</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">لا توجد تقديرات مطابقة.</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((estimate) => {
            const Icon = typeIcon[estimate.estimate_type];
            return (
              <Card
                key={estimate.id}
                className="p-4 cursor-pointer hover:border-primary/50 transition"
                onClick={() => navigate(`/estimates/${estimate.id}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon size={18} className="text-primary" />
                    <div>
                      <div className="font-mono font-bold" dir="ltr">{estimate.estimate_number}</div>
                      <div className="text-xs text-muted-foreground">{ESTIMATE_TYPE_LABEL[estimate.estimate_type].ar}</div>
                    </div>
                  </div>
                  <Badge variant="secondary">{ESTIMATE_STATUS_LABEL[estimate.status].ar}</Badge>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="font-semibold">{estimate.customer?.name || "—"}</div>
                  <div className="text-muted-foreground">{estimate.vehicle?.plate_number || "—"} • {[estimate.vehicle?.make, estimate.vehicle?.model].filter(Boolean).join(" ") || "—"}</div>
                  {estimate.claim?.claim_number && <div className="text-muted-foreground">مطالبة: {estimate.claim.claim_number}</div>}
                </div>
                <div className="mt-3 pt-3 border-t flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{estimate.estimate_date}</span>
                  <span className="font-bold">{formatOMR(estimate.total)}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
