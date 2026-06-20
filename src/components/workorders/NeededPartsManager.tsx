import { useState } from "react";
import { Plus, Trash2, Package, MessageCircle, Printer, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addNeededPartToOrder,
  updateNeededPartInOrder,
  removeNeededPartFromOrder,
  isPartStillNeeded,
  NEEDED_PART_STATUS_LABELS,
  type NeededPart,
  type NeededPartStatus,
  type WorkOrder,
} from "@/lib/workOrdersStore";
import { toast } from "sonner";

interface Props {
  order: WorkOrder;
  onPrintRequest: () => void;
  onSendWhatsApp?: () => void;
  onSendToSuppliers?: () => void;
  allowEdit: boolean;
}

const STATUS_BADGE: Record<NeededPartStatus, string> = {
  pending: "bg-warning/15 text-warning",
  ordered: "bg-info/15 text-info",
  secured: "bg-primary/15 text-primary",
  received: "bg-success/15 text-success",
};

export default function NeededPartsManager({ order, onPrintRequest, onSendWhatsApp, onSendToSuppliers, allowEdit }: Props) {
  const [draftName, setDraftName] = useState("");
  const [draftQty, setDraftQty] = useState(1);
  const [draftNotes, setDraftNotes] = useState("");

  const parts = order.partsNeeded || [];

  function handleAdd() {
    const name = draftName.trim();
    if (!name) {
      toast.error("اكتب اسم القطعة أولاً");
      return;
    }
    addNeededPartToOrder(order.id, {
      name,
      quantity: Math.max(1, Number(draftQty) || 1),
      notes: draftNotes.trim() || undefined,
      status: "pending",
    });
    setDraftName("");
    setDraftQty(1);
    setDraftNotes("");
    toast.success("تمت إضافة القطعة");
  }

  function handleStatus(partId: string, s: NeededPartStatus) {
    updateNeededPartInOrder(order.id, partId, { status: s });
  }

  function handleRemove(partId: string) {
    removeNeededPartFromOrder(order.id, partId);
    toast.success("تم حذف القطعة");
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Package size={16} className="text-info" />
          قطع الغيار المطلوبة
          <span className="text-[10px] text-muted-foreground font-normal">
            ({parts.length} بند · لا تزال مطلوبة: {parts.filter(isPartStillNeeded).length})
          </span>
        </h2>
        <div className="flex gap-2 flex-wrap">
          {onSendToSuppliers && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSendToSuppliers}
              disabled={parts.length === 0}
              className="gap-1 h-8 border-warning/40 text-warning hover:bg-warning/10 disabled:opacity-50"
            >
              <Truck size={12} /> إرسال للموردين
            </Button>
          )}
          {onSendWhatsApp && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSendWhatsApp}
              disabled={parts.length === 0}
              className="gap-1 h-8 border-success/40 text-success hover:bg-success/10 disabled:opacity-50"
            >
              <MessageCircle size={12} /> واتساب للعميل
            </Button>
          )}
          <Button
            size="sm"
            onClick={onPrintRequest}
            disabled={parts.length === 0}
            className="gradient-gold text-primary-foreground gap-1 h-8 disabled:opacity-50"
          >
            <Printer size={12} /> طباعة طلب شراء
          </Button>
        </div>
      </div>

      {/* Quick add row */}
      {allowEdit && (
        <div className="grid grid-cols-12 gap-2 items-center bg-secondary/30 border border-border rounded-lg p-2 mb-3">
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="اسم القطعة (اضغط Enter للإضافة)"
            className="col-span-5 h-9 bg-card border-border text-sm"
          />
          <Input
            type="number"
            min={1}
            value={draftQty}
            onChange={(e) => setDraftQty(Math.max(1, Number(e.target.value) || 1))}
            placeholder="كمية"
            className="col-span-2 h-9 bg-card border-border text-sm text-center"
          />
          <Input
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="ملاحظات (اختياري)"
            className="col-span-3 h-9 bg-card border-border text-sm"
          />
          <Button
            size="sm"
            onClick={handleAdd}
            className="col-span-2 h-9 gradient-gold text-primary-foreground gap-1"
          >
            <Plus size={14} /> إضافة
          </Button>
        </div>
      )}

      {parts.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          لم تُضَف قطع غيار مطلوبة بعد. أضِف القطعة من النموذج أعلاه.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30 text-xs text-muted-foreground">
                <th className="text-right py-2 px-3 font-medium w-10">#</th>
                <th className="text-right py-2 px-3 font-medium">اسم القطعة</th>
                <th className="text-center py-2 px-3 font-medium w-20">الكمية</th>
                <th className="text-right py-2 px-3 font-medium">ملاحظات</th>
                <th className="text-center py-2 px-3 font-medium w-36">الحالة</th>
                {allowEdit && <th className="text-center py-2 px-3 font-medium w-12"></th>}
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
                        <Select value={status} onValueChange={(v) => handleStatus(p.id, v as NeededPartStatus)}>
                          <SelectTrigger className={`h-7 text-[11px] border ${STATUS_BADGE[status]} mx-auto w-32`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-card border-border">
                            {(Object.keys(NEEDED_PART_STATUS_LABELS) as NeededPartStatus[]).map((s) => (
                              <SelectItem key={s} value={s} className="text-xs">
                                {NEEDED_PART_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[status]}`}>
                          {NEEDED_PART_STATUS_LABELS[status]}
                        </span>
                      )}
                    </td>
                    {allowEdit && (
                      <td className="py-2 px-3 text-center">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleRemove(p.id)}
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
