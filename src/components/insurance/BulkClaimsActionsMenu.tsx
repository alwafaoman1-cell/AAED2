// قائمة "مزيد من الإجراءات" الجماعية للمطالبات — مصنّفة حسب النوع
import { useState } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MoreHorizontal, FileText, Receipt, FileX, Download, FileSpreadsheet,
  CheckCircle, DollarSign, Archive, Send, Trash2, Sparkles, Loader2,
  MessageSquare, Building2, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  bulkCreateSeparateInvoices,
  bulkCreateGroupedInvoices,
  bulkUpdateStatus,
  reportInvoicingResult,
  validateClaimForInvoicing,
  bulkDetectDuplicates,
  bulkExportClaimsCSV,
  bulkOpenWhatsAppToCustomers,
} from "@/lib/insuranceBulkActions";
import { useDeleteClaim, type InsuranceClaim } from "@/hooks/useInsuranceClaims";
import { useQueryClient } from "@tanstack/react-query";
import Can from "@/components/Can";

interface Props {
  selected: InsuranceClaim[];
  onClear: () => void;
  /** عرض الزر بحجم صغير لشريط BulkActionBar */
  compact?: boolean;
}

export default function BulkClaimsActionsMenu({ selected, onClear, compact }: Props) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const deleteClaim = useDeleteClaim();

  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmInvoice, setConfirmInvoice] = useState<null | "selected" | "delivered_only" | "grouped">(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState<null | ReturnType<typeof bulkDetectDuplicates>>(null);

  const count = selected.length;
  const deliveredCount = selected.filter((c) => !!(c as any).delivered_at).length;
  const eligibleForInvoice = selected.filter((c) => !validateClaimForInvoicing(c));

  async function handleBulkInvoice(mode: "selected" | "delivered_only" | "grouped") {
    if (!profile?.tenant_id) {
      toast.error("لم يتم تحميل بيانات المستخدم");
      return;
    }
    const targets = mode === "delivered_only"
      ? selected.filter((c) => !!(c as any).delivered_at)
      : selected;

    if (!targets.length) {
      toast.warning("لا توجد مطالبات مؤهلة");
      return;
    }

    setBusy(true);
    try {
      const report = mode === "grouped"
        ? await bulkCreateGroupedInvoices(targets, profile.tenant_id)
        : await bulkCreateSeparateInvoices(targets, profile.tenant_id);
      reportInvoicingResult(report);
      qc.invalidateQueries({ queryKey: ["insurance_invoices"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      if (report.created > 0) onClear();
    } finally {
      setBusy(false);
      setConfirmInvoice(null);
    }
  }

  async function handleStatusChange(status: "approved" | "paid" | "cancelled" | "delivered") {
    setBusy(true);
    try {
      const res = await bulkUpdateStatus(selected.map((c) => c.id), status);
      if (res.updated) {
        toast.success(`تم تحديث ${res.updated} مطالبة إلى "${labelOf(status)}"`);
        qc.invalidateQueries({ queryKey: ["insurance_claims"] });
        onClear();
      }
    } finally {
      setBusy(false);
    }
  }

  function handleBulkDelete() {
    selected.forEach((c) => deleteClaim.mutate(c.id));
    setConfirmDelete(false);
    onClear();
  }

  function comingSoon(label: string) {
    toast.info(`${label} — قريباً ضمن المرحلة التالية`, { duration: 3000 });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size={compact ? "sm" : "default"}
            variant="default"
            className="gap-1 h-8"
            disabled={busy || count === 0}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
            مزيد من الإجراءات
            <span className="text-[10px] opacity-80 mr-1">({count})</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="text-xs">
            تم تحديد <span className="text-primary font-bold">{count}</span> مطالبة
            {deliveredCount > 0 && (
              <span className="text-emerald-600 mr-2">({deliveredCount} مُسلَّمة)</span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* --- مالية --- */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Receipt size={14} className="text-emerald-600" />
              <span>الإجراءات المالية</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-72">
                <DropdownMenuItem
                  onClick={() => setConfirmInvoice("delivered_only")}
                  disabled={deliveredCount === 0}
                  className="gap-2"
                >
                  <Receipt size={14} className="text-emerald-600" />
                  <div className="flex-1">
                    <div className="text-sm">إنشاء فواتير للمسلَّمة فقط</div>
                    <div className="text-[10px] text-muted-foreground">
                      {deliveredCount} مطالبة مؤهلة · بتاريخ التسليم الأصلي
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setConfirmInvoice("selected")}
                  disabled={eligibleForInvoice.length === 0}
                  className="gap-2"
                >
                  <Sparkles size={14} className="text-primary" />
                  <div className="flex-1">
                    <div className="text-sm">فاتورة منفصلة لكل مطالبة محددة</div>
                    <div className="text-[10px] text-muted-foreground">
                      {eligibleForInvoice.length}/{count} مؤهلة · يتم تخطي غير الجاهزة
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setConfirmInvoice("grouped")}
                  disabled={eligibleForInvoice.length === 0}
                  className="gap-2"
                >
                  <Building2 size={14} className="text-amber-600" />
                  <div className="flex-1">
                    <div className="text-sm">فاتورة جماعية لكل شركة تأمين</div>
                    <div className="text-[10px] text-muted-foreground">
                      تجميع المطالبات حسب الشركة في فاتورة واحدة متعددة البنود
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => bulkExportClaimsCSV(selected)} className="gap-2">
                  <FileSpreadsheet size={14} /> تصدير المحددة Excel/CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("إشعار دائن (Credit Note)")} className="gap-2">
                  <FileX size={14} /> إنشاء إشعار دائن
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("تصدير فواتير PDF")} className="gap-2">
                  <Download size={14} /> تصدير الفواتير PDF
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          {/* --- إجراءات المطالبات --- */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <CheckCircle size={14} className="text-success" />
              <span>إجراءات المطالبات</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuItem onClick={() => handleStatusChange("approved")} className="gap-2">
                  <CheckCircle size={14} className="text-success" /> اعتماد المحددة
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange("paid")} className="gap-2">
                  <DollarSign size={14} className="text-info" /> تحويل إلى "مدفوعة"
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange("cancelled")} className="gap-2">
                  <Archive size={14} className="text-muted-foreground" /> أرشفة (إلغاء)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleStatusChange("delivered")} className="gap-2">
                  <RefreshCw size={14} /> تحويل إلى "تم التسليم"
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange("approved")} className="gap-2">
                  <RefreshCw size={14} /> تحويل إلى "جاهزة للفوترة" (معتمدة)
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          {/* --- تواصل (Phase 2) --- */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Send size={14} className="text-primary" />
              <span>التواصل</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuItem
                  onClick={() =>
                    bulkOpenWhatsAppToCustomers(selected, (c) =>
                      `مرحباً ${c.customer?.name || ""}،\nبخصوص مطالبة التأمين ${c.claim_number} لمركبتك${c.vehicle?.plate_number ? ` (${c.vehicle.plate_number})` : ""}.\nنشكرك على ثقتك.`,
                    )
                  }
                  className="gap-2"
                >
                  <MessageSquare size={14} /> فتح واتساب للعملاء المحددين
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("واتساب لشركات التأمين")} className="gap-2">
                  <MessageSquare size={14} /> واتساب لشركات التأمين
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("إرسال رابط الفاتورة")} className="gap-2">
                  <Send size={14} /> إرسال رابط الفاتورة
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("إرسال رابط متابعة الإصلاح")} className="gap-2">
                  <Send size={14} /> إرسال رابط متابعة الإصلاح
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          {/* --- تقارير (Phase 3) --- */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <FileText size={14} className="text-amber-600" />
              <span>التقارير</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuItem onClick={() => comingSoon("تقرير حسب شركة التأمين")} className="gap-2">
                  <FileText size={14} /> تقرير حسب شركة التأمين
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("تقرير شهري للمحددة")} className="gap-2">
                  <FileText size={14} /> تقرير شهري للمحددة
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("تقرير الأرباح")} className="gap-2">
                  <FileText size={14} /> تقرير الأرباح
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("تقرير السيارات المسلَّمة")} className="gap-2">
                  <FileText size={14} /> تقرير السيارات المسلَّمة
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => comingSoon("تقرير السيارات قيد العمل")} className="gap-2">
                  <FileText size={14} /> تقرير السيارات قيد العمل
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          {/* --- بيانات --- */}
          <DropdownMenuItem onClick={() => bulkExportClaimsCSV(selected)} className="gap-2">
            <FileSpreadsheet size={14} /> تصدير المحددة CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const dups = bulkDetectDuplicates(selected);
              if (!dups.length) {
                toast.success("لا يوجد تكرار في المحددة");
              } else {
                setDuplicatesOpen(dups);
              }
            }}
            className="gap-2"
          >
            <RefreshCw size={14} /> كشف التكرار في المحددة
          </DropdownMenuItem>

          <Can module="Insurance" action="Delete">
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setConfirmDelete(true)}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <Trash2 size={14} /> حذف جماعي (مدير فقط)
            </DropdownMenuItem>
          </Can>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirm — Invoice creation */}
      <AlertDialog open={!!confirmInvoice} onOpenChange={(o) => !o && setConfirmInvoice(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmInvoice === "grouped"
                ? "تأكيد إصدار فاتورة جماعية لكل شركة تأمين"
                : "تأكيد إصدار الفواتير الضريبية"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                {confirmInvoice === "grouped"
                  ? `سيتم تجميع المطالبات المؤهلة حسب شركة التأمين في فاتورة واحدة متعددة البنود لكل شركة (${eligibleForInvoice.length}/${count} مؤهلة).`
                  : confirmInvoice === "delivered_only"
                  ? `سيتم إصدار فاتورة منفصلة لكل مطالبة مسلَّمة (${deliveredCount} مطالبة).`
                  : `سيتم إصدار فاتورة منفصلة لكل مطالبة محددة (${eligibleForInvoice.length}/${count}).`}
              </p>
              <p className="text-xs">
                • تاريخ الإصدار = تاريخ تسليم آخر مطالبة في المجموعة.<br />
                • سيتم تخطي أي مطالبة لها فاتورة نشطة مسبقاً.<br />
                • ضريبة 5% تُحتسب تلقائياً.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmInvoice && handleBulkInvoice(confirmInvoice)}>
              إصدار الفواتير
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm — Bulk delete */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف {count} مطالبة؟</AlertDialogTitle>
            <AlertDialogDescription>
              لا يمكن التراجع عن هذا الإجراء. سيتم حذف جميع البيانات المرتبطة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
            >
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicates result */}
      <AlertDialog open={!!duplicatesOpen} onOpenChange={(o) => !o && setDuplicatesOpen(null)}>
        <AlertDialogContent dir="rtl" className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>تم اكتشاف {duplicatesOpen?.length || 0} مجموعة تكرار</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 max-h-80 overflow-y-auto text-xs">
              {duplicatesOpen?.map((g) => (
                <div key={g.key} className="border rounded p-2">
                  <div className="font-bold mb-1 text-foreground">
                    {g.claims[0].vehicle?.plate_number || "—"} · {g.claims[0].insurance_company}
                  </div>
                  <ul className="list-disc mr-4 space-y-0.5">
                    {g.claims.map((c) => (
                      <li key={c.id}>
                        <span className="font-mono">{c.claim_number}</span> — {c.status} — {c.incident_date || c.created_at.slice(0, 10)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>إغلاق</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function labelOf(s: string) {
  return { approved: "معتمدة", paid: "مدفوعة", cancelled: "ملغاة", delivered: "تم التسليم" }[s] || s;
}
