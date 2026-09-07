import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck, ReceiptText } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { salesStore } from "@/lib/salesStore";
import { useCreateClaimPayment, type PaymentMethod } from "@/hooks/useClaimPayments";
import { toast } from "sonner";
import type { PaymentTarget } from "@/lib/paymentTargets";
import { queryKeys } from "@/lib/queryKeys";
import { roundMoney } from "@/lib/money";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  initialTarget?: PaymentTarget | null;
  lockInitialTarget?: boolean;
}

const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "نقدي" },
  { value: "bank_transfer", label: "تحويل بنكي" },
  { value: "cheque", label: "شيك" },
  { value: "offset", label: "مقاصة" },
];

function money(value: number) {
  return `${Number(value || 0).toFixed(3)} ر.ع`;
}

function normalizeSearch(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export default function UnifiedAddPaymentDialog({ open, onOpenChange, onSaved, initialTarget = null, lockInitialTarget = false }: Props) {
  const { hasRole } = useAuth();
  const canApproveSettlement = hasRole("admin", "manager");
  const createClaimPayment = useCreateClaimPayment();
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<PaymentTarget[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [settleWithDiscount, setSettleWithDiscount] = useState(false);
  const [settlementReason, setSettlementReason] = useState("");

  const selected = useMemo(
    () => targets.find((target) => `${target.kind}:${target.id}` === selectedKey) || null,
    [targets, selectedKey],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTargets(initialTarget ? [initialTarget] : []);
    setSelectedKey(initialTarget ? `${initialTarget.kind}:${initialTarget.id}` : "");
    setAmount("");
    setMethod("cash");
    setDate(new Date().toISOString().slice(0, 10));
    setReference("");
    setNotes("");
    setSettleWithDiscount(false);
    setSettlementReason("");
    void supabase.rpc("get_user_tenant_id").then(({ data, error }) => {
      if (error || !data) {
        setTenantId(null);
        toast.error(error?.message || "تعذّر تحديد المؤسسة");
      } else {
        setTenantId(String(data));
      }
    });
  }, [open, initialTarget]);

  useEffect(() => {
    if (!selected) return;
    const remaining = roundMoney(selected.remaining);
    setAmount(remaining > 0 ? remaining.toFixed(3) : "");
  }, [selected]);

  const settlementDiscount = useMemo(() => {
    if (!selected || selected.kind !== "insurance_claim" || !settleWithDiscount) return 0;
    return roundMoney(Math.max(0, roundMoney(selected.remaining) - roundMoney(amount)));
  }, [selected, settleWithDiscount, amount]);

  async function runSearch() {
    const needle = normalizeSearch(query);
    if (!tenantId) {
      toast.error("تعذّر تحديد المؤسسة");
      return;
    }
    if (needle.length < 2) {
      toast.error("اكتب رقم فاتورة أو مطالبة أو اسم عميل أو رقم لوحة");
      return;
    }
    setLoading(true);
    try {
      const pattern = `%${needle}%`;
      const [{ data: matchedCustomers, error: customerSearchError }, { data: matchedWorkOrders, error: workOrderSearchError }] = await Promise.all([
        (supabase.from("customers") as any)
          .select("id")
          .eq("tenant_id", tenantId)
          .or(`name.ilike.${pattern},phone.ilike.${pattern}`)
          .limit(25),
        (supabase.from("job_orders") as any)
          .select("id,order_number,vehicle_id")
          .eq("tenant_id", tenantId)
          .ilike("order_number", pattern)
          .limit(25),
      ]);
      if (customerSearchError) throw customerSearchError;
      if (workOrderSearchError) throw workOrderSearchError;
      const matchedCustomerIds = Array.from(new Set(((matchedCustomers || []) as any[]).map((row) => row.id).filter(Boolean)));
      const matchedWorkOrderIds = Array.from(new Set(((matchedWorkOrders || []) as any[]).map((row) => row.id).filter(Boolean)));
      const salesOr = [
        `doc_number.ilike.${pattern}`,
        `customer_name.ilike.${pattern}`,
        `vehicle_plate.ilike.${pattern}`,
        ...matchedCustomerIds.map((id) => `customer_id.eq.${id}`),
        ...matchedWorkOrderIds.map((id) => `work_order_id.eq.${id}`),
      ].join(",");
      const claimsOr = [
        `claim_number.ilike.${pattern}`,
        `vehicle_plate.ilike.${pattern}`,
        `insurance_company.ilike.${pattern}`,
        ...matchedCustomerIds.map((id) => `customer_id.eq.${id}`),
        ...matchedWorkOrderIds.map((id) => `job_order_id.eq.${id}`),
        ...matchedWorkOrderIds.map((id) => `auto_job_order_id.eq.${id}`),
      ].join(",");
      const [salesResult, claimsResult] = await Promise.all([
        (supabase.from("sales_documents") as any)
          .select("id,doc_number,subtotal,tax_total,total,paid_amount,balance_due,customer_id,customer_name,vehicle_plate,work_order_id,status")
          .eq("tenant_id", tenantId)
          .eq("doc_type", "invoice")
          .not("status", "in", "(cancelled,canceled,draft)")
          .or(salesOr)
          .limit(12),
        (supabase.from("insurance_claims") as any)
          .select("id,claim_number,customer_id,vehicle_id,vehicle_plate,insurance_company_id,insurance_company,estimated_amount,approved_amount,status,job_order_id,auto_job_order_id")
          .eq("tenant_id", tenantId)
          .not("status", "in", "(cancelled,rejected)")
          .or(claimsOr)
          .limit(12),
      ]);
      if (salesResult.error) throw salesResult.error;
      if (claimsResult.error) throw claimsResult.error;

      const claimRows = claimsResult.data || [];
      const claimIds = claimRows.map((row: any) => row.id);
      let paidByClaim = new Map<string, number>();
      let invoiceByClaim = new Map<string, { id: string; subtotal: number; vat: number; total: number; settlementDiscount: number }>();
      if (claimIds.length) {
        const [{ data: payments, error }, { data: invoices, error: invoicesError }] = await Promise.all([
          (supabase.from("claim_payments") as any)
            .select("claim_id,amount,status")
            .eq("tenant_id", tenantId)
            .in("claim_id", claimIds)
            .neq("status", "bounced"),
          (supabase.from("insurance_invoices") as any)
            .select("id,claim_id,subtotal,vat,total,settlement_discount_amount,issued_at")
            .eq("tenant_id", tenantId)
            .in("claim_id", claimIds)
            .neq("status", "cancelled")
            .order("issued_at", { ascending: false }),
        ]);
        if (error) throw error;
        if (invoicesError) throw invoicesError;
        paidByClaim = (payments || []).reduce((map: Map<string, number>, row: any) => {
          map.set(row.claim_id, (map.get(row.claim_id) || 0) + Number(row.amount || 0));
          return map;
        }, paidByClaim);
        invoiceByClaim = (invoices || []).reduce((map: Map<string, { id: string; subtotal: number; vat: number; total: number; settlementDiscount: number }>, row: any) => {
          if (!map.has(row.claim_id)) map.set(row.claim_id, {
            id: row.id,
            subtotal: Number(row.subtotal || 0),
            vat: Number(row.vat || 0),
            total: Number(row.total || 0),
            settlementDiscount: Number(row.settlement_discount_amount || 0),
          });
          return map;
        }, invoiceByClaim);
      }

      const salesRows = salesResult.data || [];
      const workOrderIds = Array.from(new Set([
        ...salesRows.map((row: any) => row.work_order_id).filter(Boolean),
        ...claimRows.map((row: any) => row.job_order_id || row.auto_job_order_id).filter(Boolean),
      ]));
      let workOrdersById = new Map<string, { vehicle_id: string | null; order_number: string | null }>();
      if (workOrderIds.length) {
        const { data: workOrders, error } = await (supabase.from("job_orders") as any)
          .select("id,vehicle_id,order_number")
          .eq("tenant_id", tenantId)
          .in("id", workOrderIds);
        if (error) throw error;
        workOrdersById = (workOrders || []).reduce((map: Map<string, { vehicle_id: string | null; order_number: string | null }>, row: any) => {
          map.set(row.id, { vehicle_id: row.vehicle_id || null, order_number: row.order_number || null });
          return map;
        }, workOrdersById);
      }

      const customerIds = Array.from(new Set([
        ...claimRows.map((row: any) => row.customer_id).filter(Boolean),
        ...salesRows.map((row: any) => row.customer_id).filter(Boolean),
      ]));
      let customersById = new Map<string, string>();
      if (customerIds.length) {
        const { data: customers, error } = await (supabase.from("customers") as any)
          .select("id,name")
          .eq("tenant_id", tenantId)
          .in("id", customerIds);
        if (error) throw error;
        customersById = (customers || []).reduce((map: Map<string, string>, row: any) => {
          map.set(row.id, row.name || "—");
          return map;
        }, customersById);
      }

      const salesTargets: PaymentTarget[] = salesRows.map((row: any) => {
        const total = Number(row.total || 0);
        const paid = Number(row.paid_amount || 0);
        const remaining = Number(row.balance_due ?? Math.max(0, total - paid));
        const linkedWorkOrder = row.work_order_id ? workOrdersById.get(row.work_order_id) : null;
        return {
          kind: "sales_invoice",
          id: row.id,
          number: row.doc_number,
          customerId: row.customer_id || null,
          customerName: row.customer_name || "—",
          vehicleId: linkedWorkOrder?.vehicle_id || null,
          vehiclePlate: row.vehicle_plate || null,
          workOrderId: row.work_order_id || null,
          claimId: null,
          invoiceId: row.id,
          subtotal: Number(row.subtotal || 0),
          vat: Number(row.tax_total || 0),
          total,
          paid,
          remaining,
        };
      });

      const claimTargets: PaymentTarget[] = claimRows.map((row: any) => {
        const linkedInvoice = invoiceByClaim.get(row.id);
        const total = linkedInvoice?.total ?? Number(row.approved_amount || row.estimated_amount || 0);
        const paid = paidByClaim.get(row.id) || 0;
        const discount = linkedInvoice?.settlementDiscount || 0;
        return {
          kind: "insurance_claim",
          id: row.id,
          number: row.claim_number,
          customerId: row.customer_id,
          customerName: customersById.get(row.customer_id) || "—",
          vehicleId: row.vehicle_id || null,
          vehiclePlate: row.vehicle_plate || null,
          workOrderId: row.job_order_id || row.auto_job_order_id || null,
          claimId: row.id,
          invoiceId: linkedInvoice?.id || null,
          insuranceCompanyId: row.insurance_company_id || null,
          insuranceCompany: row.insurance_company || "—",
          subtotal: linkedInvoice?.subtotal,
          vat: linkedInvoice?.vat,
          total,
          paid,
          settlementDiscount: discount,
          remaining: Math.max(0, total - paid - discount),
        };
      });

      const next = [...salesTargets, ...claimTargets].filter((target) => target.remaining > 0.001);
      setTargets(next);
      setSelectedKey(next[0] ? `${next[0].kind}:${next[0].id}` : "");
      if (!next.length) toast.info("لا توجد فاتورة أو مطالبة مفتوحة مطابقة للبحث");
    } catch (error: any) {
      toast.error(error?.message || "تعذر البحث عن الدفعة");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (savingRef.current) return;
    if (!tenantId) return toast.error("تعذّر تحديد المؤسسة");
    if (!selected) return toast.error("اختر الفاتورة أو المطالبة");
    const value = roundMoney(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("أدخل مبلغاً صحيحاً");
    const remaining = roundMoney(selected.remaining);
    if (remaining <= 0) return toast.error("الفاتورة مدفوعة بالكامل ولا يمكن تسجيل دفعة إضافية");
    if (value > remaining) return toast.error(`المبلغ يتجاوز المتبقي ${money(remaining)}`);
    if (settleWithDiscount && selected.kind !== "insurance_claim") return toast.error("خصم التسوية متاح لفواتير التأمين فقط");
    if (settleWithDiscount && !canApproveSettlement) return toast.error("خصم التسوية يحتاج صلاحية المدير");
    if (settleWithDiscount && method === "cheque") return toast.error("يُسجل الخصم بعد تحصيل الشيك وليس عند استلام شيك معلق");
    if (settleWithDiscount && settlementDiscount <= 0) return toast.error("يجب أن يكون المبلغ المستلم أقل من الرصيد لإضافة خصم تسوية");
    if (settleWithDiscount && !settlementReason.trim()) return toast.error("اكتب سبب خصم التسوية");

    savingRef.current = true;
    setSaving(true);
    try {
      if (selected.kind === "sales_invoice") {
        const refreshed = await salesStore.refreshOne(selected.invoiceId);
        if (!refreshed) throw new Error("الفاتورة المرتبطة غير موجودة أو لم تعد متاحة");
        await salesStore.addPayment(selected.invoiceId, {
          amount: value,
          method,
          date,
          reference: reference || undefined,
          note: notes || undefined,
        });
      } else {
        await createClaimPayment.mutateAsync({
          tenant_id: tenantId,
          claim_id: selected.claimId,
          insurance_company_id: selected.insuranceCompanyId,
          amount: value,
          payment_method: method,
          payment_date: date,
          offset_against_invoice_id: selected.invoiceId,
          reference_number: reference || null,
          status: method === "cheque" ? "pending" : "cleared",
          notes: notes || null,
          settlement_discount_amount: settleWithDiscount ? settlementDiscount : 0,
          settlement_discount_reason: settleWithDiscount ? settlementReason.trim() : null,
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workOrderFinancials.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.insuranceInvoices.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.claimPayments.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reportCenter.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reports.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlyVehicleProfitability.all }),
        queryClient.invalidateQueries({ queryKey: ["sales_documents"] }),
        queryClient.invalidateQueries({ queryKey: ["sales_payments"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["accounting"] }),
      ]);
      toast.success("تم حفظ الدفعة وربطها رسميًا");
      onSaved?.();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ الدفعة");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إضافة دفعة موحدة</DialogTitle>
        </DialogHeader>

        {!lockInitialTarget && <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <Search className="absolute top-2.5 right-3 h-4 w-4 text-muted-foreground" />
            <Input
              className="pr-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void runSearch(); }}
              placeholder="ابحث بالعميل، الفاتورة، المطالبة، أو رقم اللوحة"
            />
          </div>
          <Button onClick={runSearch} disabled={loading}>{loading ? "جاري البحث..." : "بحث"}</Button>
        </div>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>نتائج البحث</Label>
            <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
              {targets.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">ابحث لاختيار مصدر الدفعة</div>
              ) : targets.map((target) => {
                const key = `${target.kind}:${target.id}`;
                const active = selectedKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    className={`w-full text-right p-3 hover:bg-secondary/30 ${active ? "bg-primary/10" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {target.kind === "insurance_claim" ? <ShieldCheck size={16} /> : <ReceiptText size={16} />}
                        <span className="font-semibold">{target.number}</span>
                      </div>
                      <Badge variant={target.kind === "insurance_claim" ? "secondary" : "outline"}>
                        {target.kind === "insurance_claim" ? "مطالبة" : "فاتورة"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {target.customerName} {target.vehiclePlate ? `— ${target.vehiclePlate}` : ""}
                    </div>
                    <div className="mt-1 text-xs">
                      المتبقي: <span className="font-mono font-bold text-primary">{money(target.remaining)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border bg-secondary/20 p-3 text-sm">
              {selected ? (
                <div className="space-y-1">
                  <div className="font-semibold">{selected.kind === "insurance_claim" ? "مطالبة تأمين" : "فاتورة مبيعات"}: {selected.number}</div>
                  <div>العميل: {selected.customerName}</div>
                  {selected.vehiclePlate && <div>المركبة: {selected.vehiclePlate}</div>}
                  {selected.kind === "insurance_claim" && <div>شركة التأمين: {selected.insuranceCompany}</div>}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-2">
                    <div><span className="text-muted-foreground">قبل الضريبة</span><br />{money(selected.subtotal ?? Math.max(0, selected.total - (selected.vat || 0)))}</div>
                    <div><span className="text-muted-foreground">ضريبة الفاتورة الكاملة</span><br />{money(selected.vat || 0)}</div>
                    <div><span className="text-muted-foreground">الإجمالي شامل الضريبة</span><br />{money(selected.total)}</div>
                    <div><span className="text-muted-foreground">المدفوع</span><br />{money(selected.paid)}</div>
                    <div><span className="text-muted-foreground">المتبقي</span><br /><b>{money(selected.remaining)}</b></div>
                  </div>
                  <div className="pt-2 text-xs text-muted-foreground">
                    ضريبة الفاتورة ثابتة من إجمالي الفاتورة، والدفعة الجزئية تغيّر المدفوع والمتبقي فقط.
                  </div>
                  {selected.kind === "insurance_claim" && Number(selected.settlementDiscount || 0) > 0 && (
                    <div className="text-xs text-amber-700">خصم تسوية داخلي سابق: {money(selected.settlementDiscount || 0)}</div>
                  )}
                </div>
              ) : "اختر نتيجة لربط الدفعة رسميًا."}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>المبلغ</Label>
                <Input type="number" step="0.001" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>التاريخ</Label>
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>طريقة الدفع</Label>
                <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METHOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>رقم المرجع</Label>
                <Input value={reference} onChange={(event) => setReference(event.target.value)} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>ملاحظات</Label>
                <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
              {selected?.kind === "insurance_claim" && canApproveSettlement && (
                <div className="space-y-3 md:col-span-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label>إغلاق الفاتورة بخصم تسوية مبكرة</Label>
                      <p className="text-xs text-muted-foreground">داخلي فقط؛ لا يغيّر الفاتورة أو الضريبة ولا يظهر في PDF.</p>
                    </div>
                    <Switch checked={settleWithDiscount} onCheckedChange={setSettleWithDiscount} disabled={method === "cheque"} />
                  </div>
                  {settleWithDiscount && (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>المبلغ المستلم: <b>{money(roundMoney(amount))}</b></div>
                        <div>خصم التسوية: <b className="text-amber-700">{money(settlementDiscount)}</b></div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>سبب الخصم *</Label>
                        <Textarea rows={2} value={settlementReason} onChange={(event) => setSettlementReason(event.target.value)} placeholder="مثال: خصم مقابل تسريع سداد شركة التأمين" />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={saving || !selected}>{saving ? "جاري الحفظ..." : "حفظ الدفعة"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
