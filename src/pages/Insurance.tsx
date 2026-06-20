import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Shield, FileText, Clock, CheckCircle, XCircle, Plus, Search, DollarSign, Trash2, Eye, Ban } from "lucide-react";
import StatCard from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInsuranceClaims, useDeleteClaim } from "@/hooks/useInsuranceClaims";
import ClaimStatusDialog from "@/components/insurance/ClaimStatusDialog";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import Can from "@/components/Can";

import { toEnglishDigits, formatPlateLatin } from "@/lib/numberUtils";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const statusColors: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  paid: "bg-info/15 text-info",
  cancelled: "bg-muted text-muted-foreground",
};

const statusLabels: Record<string, string> = {
  pending: "بانتظار الموافقة",
  approved: "مقبولة",
  rejected: "مرفوضة",
  paid: "مدفوعة",
  cancelled: "ملغاة",
};

const statusIcons: Record<string, typeof CheckCircle> = {
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  paid: DollarSign,
  cancelled: Ban,
};

export default function Insurance() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: claims, isLoading } = useInsuranceClaims();
  const deleteClaim = useDeleteClaim();
  const [statusClaim, setStatusClaim] = useState<InsuranceClaim | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = claims?.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.claim_number?.toLowerCase().includes(s) ||
      c.insurance_company?.toLowerCase().includes(s) ||
      c.customer?.name?.toLowerCase().includes(s) ||
      c.vehicle?.plate_number?.toLowerCase().includes(s) ||
      ((c as any).vehicle_plate ?? "").toLowerCase().includes(s) ||
      ((c as any).vehicle_make ?? "").toLowerCase().includes(s) ||
      ((c as any).vehicle_model ?? "").toLowerCase().includes(s)
    );
  });

  const pendingCount = claims?.filter((c) => c.status === "pending").length ?? 0;
  const approvedCount = claims?.filter((c) => c.status === "approved").length ?? 0;
  const paidCount = claims?.filter((c) => c.status === "paid").length ?? 0;
  const totalAmount = claims?.reduce((sum, c) => sum + (Number(c.estimated_amount) || 0), 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("insurance.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("insurance.subtitle", "Manage claims and communicate with insurance companies")}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate("/insurance/new")} className="gap-2">
            <Plus size={18} />
            {t("insurance.newClaim")}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="إجمالي المطالبات" value={claims?.length ?? 0} icon={Shield} variant="info" />
        <StatCard title="بانتظار الموافقة" value={pendingCount} icon={Clock} variant="warning" />
        <StatCard title="مقبولة" value={approvedCount} icon={CheckCircle} variant="success" />
        <StatCard
          title="إجمالي المبالغ"
          value={`${totalAmount.toLocaleString()} ر.ع`}
          icon={FileText}
          variant="gold"
        />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="بحث برقم المطالبة، شركة التأمين، العميل..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9"
        />
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>
        ) : !filtered?.length ? (
          <div className="p-8 text-center text-muted-foreground">
            {claims?.length ? "لا توجد نتائج مطابقة" : "لا توجد مطالبات بعد. أضف أول مطالبة تأمين."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">رقم المطالبة</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">السيارة / Vehicle</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">العميل</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">شركة التأمين</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">المبلغ المقدر</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">المعتمد</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">الحالة</th>
                  <th className="text-right py-3 px-4 text-muted-foreground font-medium text-xs">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const StatusIcon = statusIcons[c.status] || Clock;
                  // بيانات السيارة: نُبرز بيانات السيارة (الماركة + الموديل + اللوحة) — اسم العميل ثانوي
                  const make = (c as any).vehicle_make ?? c.vehicle?.brand ?? "";
                  const model = (c as any).vehicle_model ?? c.vehicle?.model ?? "";
                  const plate = (c as any).vehicle_plate ?? c.vehicle?.plate_number ?? "";
                  const vehicleTitle = `${make} ${model}`.trim() || "—";
                  const plateLatin = formatPlateLatin(plate);
                  const stop = (e: React.MouseEvent) => e.stopPropagation();
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border/50 hover:bg-secondary/40 cursor-pointer transition-colors"
                      onClick={() => navigate(`/insurance/${c.id}`)}
                    >
                      <td className="py-3 px-4 font-mono text-xs text-primary" style={{ fontFamily: "Inter, monospace" }}>{toEnglishDigits(c.claim_number)}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-foreground" style={{ fontFamily: "Inter, sans-serif" }}>{vehicleTitle}</div>
                        {plate && (
                          <div className="text-[11px] mt-0.5 inline-block px-2 py-0.5 rounded bg-secondary border border-border font-mono tracking-wider" style={{ fontFamily: "Inter, monospace" }}>{plateLatin}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-1">{c.customer?.name ?? ""}</div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground hidden md:table-cell text-xs">{c.customer?.name ?? "-"}</td>
                      <td className="py-3 px-4 text-foreground">{c.insurance_company}</td>
                      <td className="py-3 px-4 text-foreground font-medium" style={{ fontFamily: "Inter, sans-serif", direction: "ltr", textAlign: "right" }}>
                        {toEnglishDigits(Number(c.estimated_amount).toLocaleString("en-US"))} OMR
                      </td>
                      <td className="py-3 px-4 text-foreground hidden md:table-cell" style={{ fontFamily: "Inter, sans-serif", direction: "ltr", textAlign: "right" }}>
                        {c.status === "approved" || c.status === "paid"
                          ? `${toEnglishDigits(Number(c.approved_amount).toLocaleString("en-US"))} OMR`
                          : "-"}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 ${statusColors[c.status]}`}>
                          <StatusIcon size={10} />
                          {statusLabels[c.status]}
                        </span>
                      </td>
                      <td className="py-3 px-4" onClick={stop}>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => { stop(e); navigate(`/insurance/${c.id}`); }}
                            title="فتح التفاصيل"
                          >
                            <Eye size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => { stop(e); setStatusClaim(c); }}
                            title="تحديث الحالة"
                          >
                            <CheckCircle size={14} />
                          </Button>
                          <Can module="Insurance/Claims" action="Delete">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={(e) => { stop(e); setDeleteId(c.id); }}
                              title="حذف"
                            >
                              <Trash2 size={14} />
                            </Button>
                          </Can>

                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ClaimStatusDialog open={!!statusClaim} onOpenChange={(o) => !o && setStatusClaim(null)} claim={statusClaim} />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المطالبة</AlertDialogTitle>
            <AlertDialogDescription>هل أنت متأكد من حذف هذه المطالبة؟ لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteId) deleteClaim.mutate(deleteId);
                setDeleteId(null);
              }}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
