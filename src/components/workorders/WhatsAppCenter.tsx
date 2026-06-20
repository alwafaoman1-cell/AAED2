import { useMemo, useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, Send, Truck, History, FileText, Package, BellRing, CreditCard, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { WorkOrder, NeededPart } from "@/lib/workOrdersStore";
import { isPartStillNeeded } from "@/lib/workOrdersStore";
import { suppliersStore, type Supplier } from "@/lib/suppliersStore";
import {
  buildPartsRequestMessage,
  buildSupplierPartsRequest,
  buildReadyForPickupMessage,
  buildPaymentFollowupMessage,
  buildCustomGreeting,
  sendWhatsAppAndLog,
  openWhatsAppWithMessage,
} from "@/lib/partsWhatsApp";
import {
  getWaLogsForOrder,
  subscribeWaLogs,
  deleteWaLog,
  WA_KIND_LABELS,
  type WaMessageLog,
} from "@/lib/waMessageLogStore";

interface Props {
  order: WorkOrder | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** افتح على تبويب محدد */
  defaultTab?: "templates" | "suppliers" | "history";
}

type TemplateKey = "parts_request" | "ready_for_pickup" | "payment_followup" | "custom";

const TEMPLATES: { key: TemplateKey; label: string; icon: any; build: (o: WorkOrder) => string; kind: any }[] = [
  { key: "parts_request", label: "طلب قطع غيار", icon: Package, build: buildPartsRequestMessage, kind: "parts_request" },
  { key: "ready_for_pickup", label: "إشعار جاهزية السيارة", icon: BellRing, build: buildReadyForPickupMessage, kind: "ready_for_pickup" },
  { key: "payment_followup", label: "متابعة دفع/فاتورة", icon: CreditCard, build: buildPaymentFollowupMessage, kind: "payment_followup" },
  { key: "custom", label: "رسالة مخصصة", icon: Pencil, build: buildCustomGreeting, kind: "custom" },
];

export default function WhatsAppCenter({ order, open, onOpenChange, defaultTab = "templates" }: Props) {
  const [tab, setTab] = useState<string>(defaultTab);
  const [activeTpl, setActiveTpl] = useState<TemplateKey>("parts_request");
  const [draft, setDraft] = useState("");
  const [logs, setLogs] = useState<WaMessageLog[]>([]);

  // Suppliers tab
  const [selectedSuppliers, setSelectedSuppliers] = useState<Set<string>>(new Set());
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [supplierSearch, setSupplierSearch] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => suppliersStore.getAll());

  // sync template draft when order or template changes
  useEffect(() => {
    if (!order) return;
    const tpl = TEMPLATES.find((t) => t.key === activeTpl);
    if (tpl) setDraft(tpl.build(order));
  }, [order, activeTpl, open]);

  // load logs + subscribe
  useEffect(() => {
    if (!order) return;
    const refresh = () => setLogs(getWaLogsForOrder(order.id));
    refresh();
    return subscribeWaLogs(refresh);
  }, [order, open]);

  // suppliers subscription
  useEffect(() => {
    return suppliersStore.subscribe(() => setSuppliers(suppliersStore.getAll()));
  }, []);

  // reset suppliers selection when dialog opens
  useEffect(() => {
    if (open && order) {
      const stillNeeded = (order.partsNeeded || []).filter(isPartStillNeeded);
      setSelectedParts(new Set(stillNeeded.map((p) => p.id)));
      setSelectedSuppliers(new Set());
      setTab(defaultTab);
    }
  }, [open, order, defaultTab]);

  if (!order) return null;

  const partsForSupplier: NeededPart[] = (order.partsNeeded || []).filter((p) => selectedParts.has(p.id));
  const filteredSuppliers = suppliers.filter(
    (s) => !supplierSearch.trim() || s.name.includes(supplierSearch) || (s.notes || "").includes(supplierSearch)
  );

  function toggleSet(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function handleSendTemplate() {
    if (!draft.trim()) {
      toast.error("النص فارغ");
      return;
    }
    const tpl = TEMPLATES.find((t) => t.key === activeTpl);
    sendWhatsAppAndLog({
      message: draft,
      phone: order!.phone,
      workOrderId: order!.id,
      kind: tpl?.kind || "custom",
      recipientName: order!.customer,
      recipientType: "customer",
    });
    toast.success(`تم فتح واتساب — تم تسجيل الرسالة في سجل الأمر`);
  }

  function handleSendToSuppliers() {
    if (selectedSuppliers.size === 0) {
      toast.error("اختر مورداً واحداً على الأقل");
      return;
    }
    if (partsForSupplier.length === 0) {
      toast.error("اختر قطعة واحدة على الأقل");
      return;
    }
    const targets = suppliers.filter((s) => selectedSuppliers.has(s.id));
    const partsList = partsForSupplier.map((p) => ({ name: p.name, quantity: p.quantity, notes: p.notes }));

    targets.forEach((sup, idx) => {
      const msg = buildSupplierPartsRequest({
        supplierName: sup.name,
        parts: partsList,
        workOrder: order!,
      });
      // stagger window.open so popups open reliably
      setTimeout(() => {
        sendWhatsAppAndLog({
          message: msg,
          phone: sup.phone,
          workOrderId: order!.id,
          kind: "parts_request_supplier",
          recipientName: sup.name,
          recipientType: "supplier",
        });
      }, idx * 250);
    });
    toast.success(`جارٍ فتح ${targets.length} نافذة واتساب — تأكد من السماح بالنوافذ المنبثقة`);
  }

  function handleResendLog(log: WaMessageLog) {
    openWhatsAppWithMessage(log.fullText, log.recipientPhone);
    toast.info(`فتح واتساب لإعادة إرسال للـ ${log.recipientName}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden bg-card border-border flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <MessageCircle size={18} className="text-success" />
            مركز واتساب — {order.id}
            <span className="text-xs text-muted-foreground font-normal">({order.customer})</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid grid-cols-3 w-full bg-secondary">
            <TabsTrigger value="templates" className="gap-1.5 text-xs">
              <FileText size={14} /> قوالب جاهزة
            </TabsTrigger>
            <TabsTrigger value="suppliers" className="gap-1.5 text-xs">
              <Truck size={14} /> إرسال للموردين
              {selectedSuppliers.size > 0 && (
                <span className="bg-primary/20 text-primary rounded-full px-1.5 text-[10px]">{selectedSuppliers.size}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5 text-xs">
              <History size={14} /> السجل
              {logs.length > 0 && <span className="bg-info/20 text-info rounded-full px-1.5 text-[10px]">{logs.length}</span>}
            </TabsTrigger>
          </TabsList>

          {/* ===== Templates ===== */}
          <TabsContent value="templates" className="flex-1 overflow-y-auto mt-3 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                const active = activeTpl === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setActiveTpl(t.key)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs transition-all ${
                      active
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-secondary/30 border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    <Icon size={18} />
                    <span className="text-center leading-tight">{t.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                نص الرسالة (يمكنك تعديله قبل الإرسال)
              </label>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                className="bg-secondary border-border text-sm font-mono leading-relaxed"
                dir="auto"
              />
              <p className="text-[10px] text-muted-foreground">
                {draft.length} حرف · سيُرسل إلى {order.customer} ({order.phone || "بدون رقم"})
              </p>
            </div>

            <Button onClick={handleSendTemplate} className="w-full gap-2 gradient-gold text-primary-foreground">
              <Send size={14} /> فتح واتساب وإرسال
            </Button>
          </TabsContent>

          {/* ===== Suppliers ===== */}
          <TabsContent value="suppliers" className="flex-1 overflow-y-auto mt-3 space-y-3">
            {/* Parts selection */}
            <div className="border border-border rounded-lg p-3 bg-secondary/20">
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <Package size={12} className="text-info" /> القطع المراد طلبها ({selectedParts.size}/{(order.partsNeeded || []).length})
              </p>
              {(order.partsNeeded || []).length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">لا توجد قطع مطلوبة في هذا الأمر.</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {(order.partsNeeded || []).map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-card cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedParts.has(p.id)}
                        onCheckedChange={() => toggleSet(selectedParts, p.id, setSelectedParts)}
                      />
                      <span className="flex-1 text-foreground">
                        {p.name || "(بدون اسم)"} <span className="text-muted-foreground">× {p.quantity}</span>
                      </span>
                      {p.notes && <span className="text-[10px] text-muted-foreground">{p.notes}</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Supplier picker */}
            <div className="border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Truck size={12} className="text-warning" /> الموردون ({selectedSuppliers.size} مختار)
                </p>
                <Input
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder="بحث..."
                  className="h-7 max-w-[180px] bg-secondary border-border text-xs"
                />
              </div>
              {suppliers.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">
                  لا يوجد موردون مسجلون. أضف موردين من صفحة المشتريات.
                </p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {filteredSuppliers.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 text-xs p-2 rounded hover:bg-secondary/40 cursor-pointer border border-transparent hover:border-border"
                    >
                      <Checkbox
                        checked={selectedSuppliers.has(s.id)}
                        onCheckedChange={() => toggleSet(selectedSuppliers, s.id, setSelectedSuppliers)}
                      />
                      <div className="flex-1">
                        <p className="text-foreground font-medium">{s.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">
                          {s.phone || "بدون رقم"} {s.notes ? `· ${s.notes}` : ""}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={handleSendToSuppliers}
              disabled={selectedSuppliers.size === 0 || partsForSupplier.length === 0}
              className="w-full gap-2 gradient-gold text-primary-foreground disabled:opacity-50"
            >
              <Send size={14} />
              فتح {selectedSuppliers.size || 0} نافذة واتساب
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              💡 تأكد أن المتصفح يسمح بالنوافذ المنبثقة لهذا الموقع.
            </p>
          </TabsContent>

          {/* ===== History ===== */}
          <TabsContent value="history" className="flex-1 overflow-y-auto mt-3">
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-12">
                لم تُرسل أي رسائل واتساب لهذا الأمر بعد.
              </p>
            ) : (
              <ScrollArea className="max-h-[55vh]">
                <ul className="space-y-2">
                  {logs.map((l) => (
                    <li
                      key={l.id}
                      className="border border-border rounded-lg p-3 bg-secondary/20 hover:bg-secondary/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                l.recipientType === "supplier"
                                  ? "bg-warning/15 text-warning"
                                  : l.recipientType === "customer"
                                  ? "bg-info/15 text-info"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {WA_KIND_LABELS[l.kind]}
                            </span>
                            <span>{l.recipientName}</span>
                            <span className="text-[10px] text-muted-foreground font-mono font-normal">
                              {l.recipientPhone}
                            </span>
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(l.sentAt).toLocaleString("ar-SA")}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-success hover:bg-success/10"
                            onClick={() => handleResendLog(l)}
                            title="إعادة إرسال"
                          >
                            <Send size={12} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10"
                            onClick={() => deleteWaLog(l.id)}
                            title="حذف من السجل"
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3 font-mono leading-relaxed">
                        {l.preview}
                        {l.fullText.length > l.preview.length && "..."}
                      </p>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
