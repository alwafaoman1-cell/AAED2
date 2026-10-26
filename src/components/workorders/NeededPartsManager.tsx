import { useState } from "react";
import { Plus, Trash2, Package, MessageCircle, Printer, Truck, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addNeededPartToOrder,
  addNeededPartsBulkToOrder,
  updateNeededPartInOrder,
  removeNeededPartFromOrder,
  normalizeNeededPartNameForMatch,
  isPartStillNeeded,
  NEEDED_PART_STATUS_LABELS,
  type NeededPart,
  type NeededPartStatus,
  type WorkOrder,
} from "@/lib/workOrdersStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface Props {
  order: WorkOrder;
  onPrintRequest: () => void;
  onSendWhatsApp?: () => void;
  onSendToSuppliers?: () => void;
  onConvertToExpense?: (part: NeededPart) => void;
  onOpenExpense?: (expenseId: string) => void;
  allowEdit: boolean;
}

const STATUS_BADGE: Record<NeededPartStatus, string> = {
  pending: "bg-warning/15 text-warning",
  ordered: "bg-info/15 text-info",
  secured: "bg-primary/15 text-primary",
  received: "bg-success/15 text-success",
};

const STATUS_EN: Record<NeededPartStatus, string> = {
  pending: "Pending",
  ordered: "Ordered",
  secured: "Secured",
  received: "Received",
};

export default function NeededPartsManager({ order, onPrintRequest, onSendWhatsApp, onSendToSuppliers, onConvertToExpense, onOpenExpense, allowEdit }: Props) {
  const { i18n } = useTranslation();
  const isEnglish = i18n.language.startsWith("en");
  const label = (ar: string, en: string) => isEnglish ? en : ar;
  const statusText = (status: NeededPartStatus) => isEnglish ? STATUS_EN[status] : NEEDED_PART_STATUS_LABELS[status];
  const [isAdding, setIsAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftQty, setDraftQty] = useState(1);
  const [draftNotes, setDraftNotes] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [partSaving, setPartSaving] = useState(false);
  const [partActionId, setPartActionId] = useState<string | null>(null);

  const parts = order.partsNeeded || [];

  async function handleAdd() {
    const name = draftName.trim();
    if (!name) {
      toast.error("اكتب اسم القطعة أولاً");
      return;
    }
    setPartSaving(true);
    try {
      const added = await addNeededPartToOrder(order.id, {
        name,
        quantity: Math.max(1, Number(draftQty) || 1),
        notes: draftNotes.trim() || undefined,
        status: "pending",
      });
      if (!added) throw new Error("أمر العمل غير موجود");
      setDraftName("");
      setDraftQty(1);
      setDraftNotes("");
      setIsAdding(false);
      toast.success("تم حفظ القطعة ومزامنتها");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ القطعة في Supabase");
    } finally {
      setPartSaving(false);
    }
  }

  async function handleStatus(partId: string, s: NeededPartStatus) {
    if (partActionId) return;
    setPartActionId(partId);
    try {
      const saved = await updateNeededPartInOrder(order.id, partId, { status: s });
      if (!saved) throw new Error("أمر العمل غير موجود");
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحديث حالة القطعة في Supabase");
    } finally {
      setPartActionId(null);
    }
  }

  async function handleRemove(partId: string) {
    if (partActionId) return;
    setPartActionId(partId);
    try {
      await removeNeededPartFromOrder(order.id, partId);
      toast.success("تم حذف القطعة نهائيًا من أمر العمل");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حذف القطعة من Supabase");
    } finally {
      setPartActionId(null);
    }
  }

  async function handleBulkAdd() {
    const names = bulkText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!names.length) {
      toast.error("الصق قائمة قطع الغيار أولاً، كل قطعة في سطر مستقل");
      return;
    }

    const existing = new Set(parts.map((p) => normalizeNeededPartNameForMatch(p.name)).filter(Boolean));
    const uniqueIncoming = names.filter((name, index, arr) => {
      const key = normalizeNeededPartNameForMatch(name);
      return key && !existing.has(key) && arr.findIndex((x) => normalizeNeededPartNameForMatch(x) === key) === index;
    });
    if (!uniqueIncoming.length) {
      toast.error("لم تتم إضافة أي قطعة: كل الأسماء موجودة مسبقًا أو مكررة");
      return;
    }

    setBulkSaving(true);
    try {
      const result = await addNeededPartsBulkToOrder(order.id, names);
      if (!result.added.length) {
        toast.error("لم تتم إضافة أي قطعة جديدة");
        return;
      }
      setBulkText("");
      const skippedText = result.skipped.length ? ` — تم تجاهل ${result.skipped.length} مكرر` : "";
      toast.success(`تمت إضافة ${result.added.length} قطعة بنجاح${skippedText}`);
    } catch (error: any) {
      toast.error(error?.message || "فشل حفظ قائمة قطع الغيار");
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
          <Package size={16} className="text-info" />
          {label("قطع الغيار المطلوبة", "Required spare parts")}
          <span className="text-xs font-normal text-muted-foreground">
            ({parts.length} · {label("مفتوحة", "open")}: {parts.filter(isPartStillNeeded).length})
          </span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {allowEdit && (
            <Button type="button" size="sm" onClick={() => setIsAdding((value) => !value)} aria-expanded={isAdding} aria-controls="needed-parts-editor" className="min-h-9 gap-1 gradient-gold text-primary-foreground">
              <Plus size={14} /> {isAdding ? label("إغلاق المحرر", "Close editor") : label("إضافة قطعة", "Add part")}
            </Button>
          )}
          {parts.length > 0 && onSendToSuppliers && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSendToSuppliers}
              className="min-h-9 gap-1 border-warning/40 text-warning hover:bg-warning/10"
            >
              <Truck size={12} /> {label("إرسال للموردين", "Send to suppliers")}
            </Button>
          )}
          {parts.length > 0 && onSendWhatsApp && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSendWhatsApp}
              className="min-h-9 gap-1 border-success/40 text-success hover:bg-success/10"
            >
              <MessageCircle size={12} /> {label("واتساب للعميل", "WhatsApp customer")}
            </Button>
          )}
          {parts.length > 0 && <Button
            size="sm"
            onClick={onPrintRequest}
            className="min-h-9 gap-1 border border-border bg-card text-foreground hover:bg-muted"
          >
            <Printer size={12} /> {label("طباعة طلب شراء", "Print parts request")}
          </Button>}
        </div>
      </div>

      {allowEdit && isAdding && (
        <div id="needed-parts-editor" className="mb-3 space-y-2">
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-secondary/30 p-2 sm:grid-cols-[minmax(0,2fr)_5rem_minmax(0,1fr)_auto] sm:items-center">
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={label("اسم القطعة (Enter للإضافة)", "Part name (Enter to add)")}
            aria-label={label("اسم القطعة", "Part name")}
            className="h-10 min-w-0 bg-card border-border text-sm"
          />
          <Input
            type="number"
            min={1}
            value={draftQty}
            onChange={(e) => setDraftQty(Math.max(1, Number(e.target.value) || 1))}
            placeholder={label("كمية", "Quantity")}
            aria-label={label("الكمية", "Quantity")}
            className="h-10 min-w-0 bg-card border-border text-center text-sm"
          />
          <Input
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={label("ملاحظات (اختياري)", "Notes (optional)")}
            aria-label={label("ملاحظات القطعة", "Part notes")}
            className="h-10 min-w-0 bg-card border-border text-sm"
          />
          <Button
            size="sm"
            onClick={() => void handleAdd()}
            disabled={partSaving}
            className="h-10 gap-1 gradient-gold text-primary-foreground"
          >
            <Plus size={14} /> {partSaving ? label("جاري الحفظ...", "Saving...") : label("إضافة", "Add")}
          </Button>
        </div>
        <div className="rounded-lg border border-dashed border-info/40 bg-info/5 p-2">
          <Textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={label("لصق قائمة قطع الغيار — كل سطر قطعة مستقلة", "Paste a parts list — one part per line")}
            className="min-h-24 bg-card text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {label("يتم تجاهل الأسطر الفارغة والقطع المكررة. الكمية الافتراضية: 1.", "Empty and duplicate lines are skipped. Default quantity: 1.")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleBulkAdd}
              disabled={bulkSaving || !bulkText.trim()}
              className="gap-1"
            >
              <Plus size={13} /> {bulkSaving ? label("جاري الحفظ...", "Saving...") : label("إضافة القائمة", "Add list")}
            </Button>
          </div>
        </div>
        </div>
      )}

      {parts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          {label("لا توجد قطع غيار مطلوبة بعد.", "No required spare parts yet.")}
        </p>
      ) : (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                <th className="w-10 px-3 py-2 text-start font-medium">#</th>
                <th className="px-3 py-2 text-start font-medium">{label("اسم القطعة", "Part")}</th>
                <th className="w-20 px-3 py-2 text-center font-medium">{label("الكمية", "Qty")}</th>
                <th className="px-3 py-2 text-start font-medium">{label("ملاحظات", "Notes")}</th>
                <th className="w-36 px-3 py-2 text-center font-medium">{label("الحالة", "Status")}</th>
                <th className="w-44 px-3 py-2 text-center font-medium">{label("المصروف", "Expense")}</th>
                {allowEdit && <th className="w-12 px-3 py-2 text-center font-medium">{label("حذف", "Delete")}</th>}
              </tr>
            </thead>
            <tbody>
              {parts.map((p, i) => {
                const status: NeededPartStatus = p.status || (p.fulfilled ? "received" : "pending");
                const done = status === "received" || status === "secured";
                return (
                  <tr key={p.id} className="border-b border-border/40">
                    <td className="py-2 px-3 text-muted-foreground">{i + 1}</td>
                    <td className={`py-2 px-3 ${done ? "line-through opacity-60" : "text-foreground font-medium"}`}>
                      {p.name || "-"}
                    </td>
                    <td className="py-2 px-3 text-center font-bold">{p.quantity}</td>
                    <td className="py-2 px-3 text-muted-foreground text-xs">{p.notes || "-"}</td>
                    <td className="py-2 px-3 text-center">
                      {allowEdit ? (
                        <Select value={status} disabled={partActionId === p.id} onValueChange={(v) => void handleStatus(p.id, v as NeededPartStatus)}>
                          <SelectTrigger className={`h-8 border text-xs ${STATUS_BADGE[status]} mx-auto w-32`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {(Object.keys(NEEDED_PART_STATUS_LABELS) as NeededPartStatus[]).map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">
                                {statusText(s)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[status]}`}>
                          {statusText(status)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {p.convertedToExpense ? (
                        <button
                          type="button"
                          onClick={() => p.convertedExpenseId && onOpenExpense?.(p.convertedExpenseId)}
                          className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-semibold text-success hover:bg-success/20"
                        >
                          <Receipt size={12} /> {label("تم تحويلها إلى مصروف", "Converted to expense")}
                        </button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!allowEdit || !onConvertToExpense}
                          onClick={() => onConvertToExpense?.(p)}
                          className="min-h-8 gap-1 text-xs"
                        >
                          <Receipt size={12} /> {label("تحويل إلى مصروف", "Convert to expense")}
                        </Button>
                      )}
                    </td>
                    {allowEdit && (
                      <td className="py-2 px-3 text-center">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={label(`حذف القطعة ${p.name}`, `Remove part ${p.name}`)}
                          onClick={() => void handleRemove(p.id)}
                          disabled={partActionId === p.id}
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
