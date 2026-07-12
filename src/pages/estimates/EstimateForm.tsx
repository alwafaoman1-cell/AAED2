import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatOMR } from "@/lib/money";
import {
  ESTIMATE_CATEGORY_LABEL,
  calculateEstimateTotals,
  createUnifiedEstimate,
  getUnifiedEstimate,
  updateUnifiedEstimate,
  type EstimateItemCategory,
  type EstimateItemInput,
  type EstimateType,
  type UnifiedEstimate,
} from "@/lib/unifiedEstimates";

const emptyItem: EstimateItemInput = {
  category: "labor",
  description_ar: "",
  description_en: "",
  quantity: 1,
  unit_price: 0,
  vat_rate: 5,
};

type EstimateSearchResult = {
  type: "vehicle" | "claim" | "work_order";
  id: string;
  title: string;
  subtitle: string;
  customer_id: string | null;
  vehicle_id: string | null;
  claim_id: string | null;
  work_order_id: string | null;
  customer?: { id?: string; name?: string | null; phone?: string | null; customer_code?: string | null } | null;
  vehicle?: { id?: string; brand?: string | null; make?: string | null; model?: string | null; year?: number | null; plate_number?: string | null; vin_number?: string | null } | null;
};

export default function EstimateForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const isEdit = Boolean(id);
  const defaultType = (searchParams.get("type") as EstimateType | null) || "independent";

  const { data: existing } = useQuery({
    queryKey: ["unified-estimate", id],
    queryFn: () => getUnifiedEstimate(id!),
    enabled: isEdit,
  });
  const { data: lookups } = useQuery({
    queryKey: ["estimate-lookups"],
    queryFn: async () => {
      const [customers, vehicles, claims, workOrders, estimates] = await Promise.all([
        supabase.from("customers").select("id,name,phone,customer_code").order("created_at", { ascending: false }).limit(200),
        supabase.from("vehicles").select("id,brand,model,plate_number,vin,vin_number,year,customer_id").order("created_at", { ascending: false }).limit(200),
        supabase.from("insurance_claims").select("id,claim_number,insurance_company,customer_id,vehicle_id").order("created_at", { ascending: false }).limit(200),
        supabase.from("job_orders").select("id,order_number,status,customer_id,vehicle_id,claim_id").order("created_at", { ascending: false }).limit(200),
        supabase.from("estimates" as any).select("id,estimate_number,estimate_type,total").order("created_at", { ascending: false }).limit(200),
      ]);
      for (const result of [customers, vehicles, claims, workOrders, estimates]) {
        if (result.error) throw result.error;
      }
      return {
        customers: customers.data || [],
        vehicles: vehicles.data || [],
        claims: claims.data || [],
        workOrders: workOrders.data || [],
        estimates: estimates.data || [],
      };
    },
  });

  const [form, setForm] = useState<Partial<UnifiedEstimate>>({
    estimate_type: defaultType,
    status: "draft",
    claim_id: searchParams.get("claimId"),
    work_order_id: searchParams.get("workOrderId"),
    parent_estimate_id: searchParams.get("parentEstimateId"),
    estimate_date: new Date().toISOString().slice(0, 10),
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    vat_rate: 5,
    vat_enabled: false,
    currency: "OMR",
    vehicle_presence_status: "with_customer",
  });
  const [items, setItems] = useState<EstimateItemInput[]>([{ ...emptyItem }]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<EstimateSearchResult[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<EstimateSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setForm({ ...existing, vat_enabled: Boolean(existing.vat_enabled) });
    setItems((existing.items || []).map((item) => ({
      category: item.category,
      description_ar: item.description_ar,
      description_en: item.description_en,
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
      notes: item.notes,
    })));
  }, [existing]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    const timer = window.setTimeout(async () => {
      try {
        const pattern = `%${term.replace(/[%_]/g, "")}%`;
        const [vehiclesRes, claimsRes, ordersRes] = await Promise.all([
          supabase
            .from("vehicles" as any)
            .select("id,brand,model,year,plate_number,plate_letters,vin_number,customer_id,customer:customers(id,name,phone,customer_code)")
            .or(`plate_number.ilike.${pattern},plate_letters.ilike.${pattern},vin_number.ilike.${pattern},brand.ilike.${pattern},model.ilike.${pattern}`)
            .limit(8),
          supabase
            .from("insurance_claims" as any)
            .select("id,claim_number,insurance_company,customer_id,vehicle_id,job_order_id,auto_job_order_id,customer:customers(id,name,phone,customer_code),vehicle:vehicles(id,brand,model,year,plate_number,vin_number)")
            .or(`claim_number.ilike.${pattern},insurance_company.ilike.${pattern}`)
            .limit(8),
          supabase
            .from("job_orders" as any)
            .select("id,order_number,status,customer_id,vehicle_id,claim_id,customer:customers(id,name,phone,customer_code),vehicle:vehicles(id,brand,model,year,plate_number,vin_number)")
            .or(`order_number.ilike.${pattern},insurance_claim_number.ilike.${pattern},description.ilike.${pattern}`)
            .limit(8),
        ]);
        for (const result of [vehiclesRes, claimsRes, ordersRes]) {
          if (result.error) throw result.error;
        }
        if (cancelled) return;
        const vehicleRows = ((vehiclesRes.data || []) as any[]).map((v): EstimateSearchResult => ({
          type: "vehicle",
          id: v.id,
          title: `${[v.plate_letters, v.plate_number].filter(Boolean).join(" ").trim() || v.plate_number || "Vehicle"} • ${[v.brand, v.model, v.year].filter(Boolean).join(" ")}`,
          subtitle: `${v.customer?.customer_code || ""} ${v.customer?.name || ""} ${v.customer?.phone || ""}`.trim(),
          customer_id: v.customer_id || null,
          vehicle_id: v.id,
          claim_id: null,
          work_order_id: null,
          customer: v.customer || null,
          vehicle: v,
        }));
        const claimRows = ((claimsRes.data || []) as any[]).map((c): EstimateSearchResult => ({
          type: "claim",
          id: c.id,
          title: `${c.claim_number || "Claim"} • ${c.insurance_company || "—"}`,
          subtitle: `${c.customer?.customer_code || ""} ${c.customer?.name || ""} • ${c.vehicle?.plate_number || ""}`.trim(),
          customer_id: c.customer_id || null,
          vehicle_id: c.vehicle_id || null,
          claim_id: c.id,
          work_order_id: c.job_order_id || c.auto_job_order_id || null,
          customer: c.customer || null,
          vehicle: c.vehicle || null,
        }));
        const orderRows = ((ordersRes.data || []) as any[]).map((o): EstimateSearchResult => ({
          type: "work_order",
          id: o.id,
          title: `${o.order_number || "WO"} • ${o.status || "—"}`,
          subtitle: `${o.customer?.customer_code || ""} ${o.customer?.name || ""} • ${o.vehicle?.plate_number || ""}`.trim(),
          customer_id: o.customer_id || null,
          vehicle_id: o.vehicle_id || null,
          claim_id: o.claim_id || null,
          work_order_id: o.id,
          customer: o.customer || null,
          vehicle: o.vehicle || null,
        }));
        setSearchResults([...claimRows, ...orderRows, ...vehicleRows].slice(0, 12));
      } catch (error: any) {
        if (!cancelled) setSearchError(error?.message || "فشل البحث");
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    if (!lookups || isEdit) return;
    setForm((current) => {
      const next = { ...current };
      if (current.claim_id) {
        const claim = lookups.claims.find((claim: any) => claim.id === current.claim_id);
        if (claim) {
          next.customer_id = next.customer_id || claim.customer_id || null;
          next.vehicle_id = next.vehicle_id || claim.vehicle_id || null;
        }
      }
      if (current.work_order_id) {
        const workOrder = lookups.workOrders.find((order: any) => order.id === current.work_order_id);
        if (workOrder) {
          next.customer_id = next.customer_id || workOrder.customer_id || null;
          next.vehicle_id = next.vehicle_id || workOrder.vehicle_id || null;
          next.claim_id = next.claim_id || workOrder.claim_id || null;
        }
      }
      return next;
    });
  }, [isEdit, lookups]);

  const totals = useMemo(() => calculateEstimateTotals(items, Number(form.vat_rate ?? 5), Boolean(form.vat_enabled)), [form.vat_enabled, form.vat_rate, items]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (form.estimate_type === "supplementary" && !form.parent_estimate_id) {
        throw new Error("التقدير الإضافي يجب أن يرتبط بتقدير أصلي.");
      }
      if (form.vehicle_presence_status === "in_workshop" && !String(form.vehicle_location_section || "").trim()) {
        throw new Error("موقع المركبة داخل الورشة مطلوب عند اختيار داخل الكراج.");
      }
      if (isEdit && id) {
        await updateUnifiedEstimate(id, { estimate: form, items });
        return { id };
      }
      return createUnifiedEstimate({ estimate: form, items });
    },
    onSuccess: (estimate: any) => {
      qc.invalidateQueries({ queryKey: ["unified-estimates"] });
      toast.success("تم حفظ التقدير");
      navigate(`/estimates/${estimate.id}`);
    },
    onError: (error: any) => toast.error(error?.message || "فشل حفظ التقدير"),
  });

  function patchItem(index: number, patch: Partial<EstimateItemInput>) {
    setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function addItem() {
    setItems((current) => [...current, { ...emptyItem }]);
  }

  function removeItem(index: number) {
    setItems((current) => current.length <= 1 ? current : current.filter((_, i) => i !== index));
  }

  function onClaimChange(claimId: string) {
    const claim = lookups?.claims.find((c: any) => c.id === claimId);
    setForm({
      ...form,
      claim_id: claimId === "none" ? null : claimId,
      customer_id: claim?.customer_id || form.customer_id || null,
      vehicle_id: claim?.vehicle_id || form.vehicle_id || null,
    });
  }

  function selectSearchResult(result: EstimateSearchResult) {
    setSelectedRecord(result);
    setSearchTerm(result.title);
    setSearchResults([]);
    setForm((current) => ({
      ...current,
      customer_id: result.customer_id || current.customer_id || null,
      vehicle_id: result.vehicle_id || current.vehicle_id || null,
      claim_id: result.claim_id || current.claim_id || null,
      work_order_id: result.work_order_id || current.work_order_id || null,
      estimate_type: result.claim_id ? "insurance" : current.estimate_type,
    }));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isEdit ? "تعديل تقدير" : "إنشاء تقدير موحد"}</h1>
          <p className="text-sm text-muted-foreground">كل الأسعار هنا قبل الضريبة. VAT يضاف فوق السعر فقط.</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/estimates")} className="gap-2">
          <ArrowRight size={16} /> رجوع
        </Button>
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label>Estimate Type</Label>
          <Select value={form.estimate_type || "independent"} onValueChange={(v) => setForm({ ...form, estimate_type: v as EstimateType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="independent">Independent Estimate</SelectItem>
              <SelectItem value="insurance">Insurance Estimate</SelectItem>
              <SelectItem value="supplementary">Supplementary Estimate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2 relative">
          <Label>Search Vehicle / Claim / Work Order</Label>
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ابحث عن المركبة أو رقم المطالبة أو أمر العمل"
              className="pr-9"
            />
            {searchLoading && <Loader2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          {(searchResults.length > 0 || searchError || (searchTerm.trim().length >= 2 && !searchLoading)) && (
            <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-lg">
              {searchError && <div className="p-2 text-sm text-destructive">{searchError}</div>}
              {!searchError && searchResults.length === 0 && <div className="p-2 text-sm text-muted-foreground">No results</div>}
              {searchResults.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  type="button"
                  onClick={() => selectSearchResult(result)}
                  className="w-full rounded-sm px-3 py-2 text-right hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{result.title}</span>
                    <span className="text-[11px] uppercase text-muted-foreground">{result.type}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{result.subtitle || "—"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedRecord && (
          <div className="md:col-span-3 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-semibold">Selected: {selectedRecord.title}</div>
            <div className="text-muted-foreground">{selectedRecord.subtitle || "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              روابط محفوظة: customer_id {selectedRecord.customer_id ? "✓" : "—"} • vehicle_id {selectedRecord.vehicle_id ? "✓" : "—"} • claim_id {selectedRecord.claim_id ? "✓" : "—"} • work_order_id {selectedRecord.work_order_id ? "✓" : "—"}
            </div>
          </div>
        )}
        <div>
          <Label>Estimate Date</Label>
          <Input type="date" value={form.estimate_date || ""} onChange={(e) => setForm({ ...form, estimate_date: e.target.value })} />
        </div>
        <div>
          <Label>Valid Until</Label>
          <Input type="date" value={form.valid_until || ""} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
        </div>
        <div>
          <Label>Vehicle Received</Label>
          <Input type="datetime-local" value={String(form.vehicle_received_at || "").slice(0, 16)} onChange={(e) => setForm({ ...form, vehicle_received_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
        </div>
        <div>
          <Label>Work Started</Label>
          <Input type="datetime-local" value={String(form.work_started_at || "").slice(0, 16)} onChange={(e) => setForm({ ...form, work_started_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
        </div>
        <div>
          <Label>Vehicle Delivered</Label>
          <Input type="datetime-local" value={String(form.vehicle_delivered_at || "").slice(0, 16)} onChange={(e) => setForm({ ...form, vehicle_delivered_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
        </div>
        <div>
          <Label>Vehicle Status</Label>
          <Select value={form.vehicle_presence_status || "with_customer"} onValueChange={(v) => setForm({ ...form, vehicle_presence_status: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="with_customer">مع العميل</SelectItem>
              <SelectItem value="in_workshop">داخل الكراج</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.vehicle_presence_status === "in_workshop" && (
          <>
            <div>
              <Label>Location Section</Label>
              <Input value={form.vehicle_location_section || ""} onChange={(e) => setForm({ ...form, vehicle_location_section: e.target.value })} />
            </div>
            <div>
              <Label>Bay</Label>
              <Input value={form.vehicle_location_bay || ""} onChange={(e) => setForm({ ...form, vehicle_location_bay: e.target.value })} />
            </div>
            <div>
              <Label>Location Note</Label>
              <Input value={form.vehicle_location_note || ""} onChange={(e) => setForm({ ...form, vehicle_location_note: e.target.value })} />
            </div>
          </>
        )}
        <div>
          <Label>Customer</Label>
          <Select value={form.customer_id || "none"} onValueChange={(v) => setForm({ ...form, customer_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.customer_code || "CUST"} • {c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Vehicle</Label>
          <Select value={form.vehicle_id || "none"} onValueChange={(v) => setForm({ ...form, vehicle_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="اختر المركبة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.vehicles.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate_number || "—"} • {[v.brand || v.make, v.model].filter(Boolean).join(" ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Claim</Label>
          <Select value={form.claim_id || "none"} onValueChange={onClaimChange}>
            <SelectTrigger><SelectValue placeholder="اختر المطالبة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.claims.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.claim_number} • {c.insurance_company}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Work Order</Label>
          <Select value={form.work_order_id || "none"} onValueChange={(v) => setForm({ ...form, work_order_id: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="اختر أمر العمل" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— بدون —</SelectItem>
              {lookups?.workOrders.map((w: any) => <SelectItem key={w.id} value={w.id}>{w.order_number} • {w.status}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {form.estimate_type === "supplementary" && (
          <div>
            <Label>Parent Estimate</Label>
            <Select value={form.parent_estimate_id || "none"} onValueChange={(v) => setForm({ ...form, parent_estimate_id: v === "none" ? null : v })}>
              <SelectTrigger><SelectValue placeholder="اختر التقدير الأصلي" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— اختر —</SelectItem>
                {lookups?.estimates.map((e: any) => <SelectItem key={e.id} value={e.id}>{e.estimate_number} • {formatOMR(e.total)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Purpose / Reason</Label>
          <Input value={form.purpose || ""} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">البنود</h2>
          <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-2"><Plus size={14} /> بند</Button>
        </div>
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 md:col-span-2">
                <Label>الفئة</Label>
                <Select value={item.category} onValueChange={(v) => patchItem(index, { category: v as EstimateItemCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ESTIMATE_CATEGORY_LABEL).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label.ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-12 md:col-span-4">
                <Label>الوصف</Label>
                <Input value={item.description_ar || ""} onChange={(e) => patchItem(index, { description_ar: e.target.value })} />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label>الكمية</Label>
                <Input type="number" step="0.001" value={item.quantity} onChange={(e) => patchItem(index, { quantity: Number(e.target.value) })} />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label>السعر قبل VAT</Label>
                <Input type="number" step="0.001" value={item.unit_price} onChange={(e) => patchItem(index, { unit_price: Number(e.target.value) })} />
              </div>
              <div className="col-span-3 md:col-span-1 text-sm font-mono pb-2">{formatOMR((Number(item.quantity) || 0) * (Number(item.unit_price) || 0), "")}</div>
              <div className="col-span-1">
                <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)} className="text-destructive">
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">
        <Card className="p-4 space-y-3">
          <div>
            <Label>Terms</Label>
            <Textarea rows={4} value={form.terms || ""} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <div className="font-semibold">تفعيل الضريبة VAT 5%</div>
              <div className="text-xs text-muted-foreground">OFF افتراضيًا. عند الإغلاق يبقى subtotal = total.</div>
            </div>
            <Switch checked={Boolean(form.vat_enabled)} onCheckedChange={(checked) => setForm({ ...form, vat_enabled: checked })} />
          </div>
          <div className="flex justify-between"><span>Subtotal before VAT</span><strong>{formatOMR(totals.subtotal)}</strong></div>
          <div className="flex justify-between"><span>{form.vat_enabled ? "VAT 5%" : "VAT: Not Applied"}</span><strong>{formatOMR(totals.vat_amount)}</strong></div>
          <div className="flex justify-between text-lg border-t pt-2"><span>Total</span><strong>{formatOMR(totals.total)}</strong></div>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="w-full gap-2 mt-3">
            <Save size={16} /> حفظ
          </Button>
        </Card>
      </div>
    </div>
  );
}
