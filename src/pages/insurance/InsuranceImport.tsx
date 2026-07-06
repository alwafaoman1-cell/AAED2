import { useState } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Download, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { calculateVatExclusive, calculateVatInclusive } from "@/lib/money";

interface ClaimRow {
  claim_ref: string;
  claim_date: string;
  claim_number?: string;
  insurance_company: string;
  policy_number?: string;
  customer_name: string;
  customer_phone?: string;
  plate: string;
  brand: string;
  model: string;
  year?: number;
  color?: string;
  vin?: string;
  estimated_amount?: number;
  approved_amount?: number;
  total_with_vat?: number;
  status?: string;
  notes?: string;
}
interface ItemRow { claim_ref: string; description: string; quantity: number; unit_price: number; type?: string; }
interface PaymentRow {
  claim_ref: string; payment_date: string; amount: number;
  payment_method: string; reference_number?: string; bank_name?: string;
  cheque_due_date?: string; notes?: string;
}

interface LogLine { kind: "info" | "ok" | "err"; msg: string; }

const HEADER_MAP_CLAIM: Record<string, keyof ClaimRow> = {
  "claim_ref*": "claim_ref", "claim_ref": "claim_ref",
  "تاريخ المطالبة*": "claim_date", "تاريخ المطالبة": "claim_date",
  "رقم المطالبة": "claim_number",
  "شركة التأمين*": "insurance_company", "شركة التأمين": "insurance_company",
  "رقم الوثيقة": "policy_number",
  "اسم العميل*": "customer_name", "اسم العميل": "customer_name",
  "هاتف العميل": "customer_phone",
  "رقم اللوحة*": "plate", "رقم اللوحة": "plate",
  "الماركة*": "brand", "الماركة": "brand",
  "الموديل*": "model", "الموديل": "model",
  "سنة الصنع": "year", "اللون": "color", "رقم الشاسيه": "vin", "VIN": "vin",
  "المبلغ المقدر": "estimated_amount", "تقدير": "estimated_amount",
  "المبلغ المعتمد": "approved_amount",
  "شامل الضريبة": "total_with_vat", "الإجمالي شامل الضريبة": "total_with_vat",
  "الحالة": "status", "ملاحظات": "notes",
};
const HEADER_MAP_ITEM: Record<string, keyof ItemRow> = {
  "claim_ref*": "claim_ref", "claim_ref": "claim_ref",
  "البيان*": "description", "البيان": "description",
  "الكمية": "quantity", "السعر*": "unit_price", "السعر": "unit_price",
  "النوع": "type",
};
const HEADER_MAP_PAY: Record<string, keyof PaymentRow> = {
  "claim_ref*": "claim_ref", "claim_ref": "claim_ref",
  "تاريخ الدفع*": "payment_date", "تاريخ الدفع": "payment_date",
  "المبلغ*": "amount", "المبلغ": "amount",
  "طريقة الدفع*": "payment_method", "طريقة الدفع": "payment_method",
  "رقم المرجع": "reference_number",
  "البنك": "bank_name",
  "تاريخ استحقاق الشيك": "cheque_due_date",
  "ملاحظات": "notes",
};

function toIso(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Excel serial
  const n = Number(s);
  if (!isNaN(n) && n > 30000) {
    const d = XLSX.SSF.parse_date_code(n);
    if (d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function num(v: any, d = 0): number { const n = Number(v); return isNaN(n) ? d : n; }

function mapRow<T>(row: any, map: Record<string, keyof T>): T {
  const out: any = {};
  for (const k in row) {
    const key = map[k.trim()];
    if (key) out[key] = row[k];
  }
  return out as T;
}

export default function InsuranceImport() {
  const { profile } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [summary, setSummary] = useState<{ claims: number; invoices: number; payments: number; errors: number; duplicates: number } | null>(null);
  const [duplicates, setDuplicates] = useState<string[]>([]);

  function log(kind: LogLine["kind"], msg: string) {
    setLogs((l) => [...l, { kind, msg }]);
  }

  async function downloadTemplate() {
    // Minimal client-side template
    const wb = XLSX.utils.book_new();
    const claims = [Object.keys(HEADER_MAP_CLAIM).filter(k => !k.includes("*") || true).slice(0, 22)];
    const items = [["claim_ref*","البيان*","الكمية","السعر*","النوع"]];
    const pays = [["claim_ref*","تاريخ الدفع*","المبلغ*","طريقة الدفع*","رقم المرجع","البنك","تاريخ استحقاق الشيك","ملاحظات"]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["claim_ref*","تاريخ المطالبة*","رقم المطالبة","شركة التأمين*","رقم الوثيقة","اسم العميل*","هاتف العميل","رقم اللوحة*","الماركة*","الموديل*","سنة الصنع","اللون","رقم الشاسيه","المبلغ المقدر","المبلغ المعتمد","الحالة","ملاحظات"],
      ["CLM001","2026-04-15","CLM-2026-001","أكسا للتأمين","POL-1","أحمد محمد","96891234567","12345 أ","تويوتا","كامري",2022,"أبيض","",450,420,"approved",""],
    ]), "المطالبات");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      items[0], ["CLM001","صبغ الصدام",1,200,"labor"], ["CLM001","قطع غيار",1,220,"parts"]
    ]), "بنود الفاتورة");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      pays[0], ["CLM001","2026-05-01",399,"bank_transfer","TRX-1","بنك مسقط","",""]
    ]), "الدفعات");
    XLSX.writeFile(wb, "insurance_import_template.xlsx");
  }

  async function handleImport() {
    if (!file || !profile?.tenant_id) return;
    setBusy(true); setLogs([]); setProgress(0); setSummary(null); setDuplicates([]);
    let claimsCount = 0, invoicesCount = 0, paymentsCount = 0, errors = 0, duplicatesCount = 0;
    const dupList: string[] = [];

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const claimsSheet = wb.Sheets["المطالبات"];
      const itemsSheet = wb.Sheets["بنود الفاتورة"];
      const paySheet = wb.Sheets["الدفعات"];
      if (!claimsSheet) throw new Error("صفحة 'المطالبات' غير موجودة في الملف");

      const claimRows: ClaimRow[] = XLSX.utils.sheet_to_json<any>(claimsSheet, { defval: "" })
        .map(r => mapRow<ClaimRow>(r, HEADER_MAP_CLAIM))
        .map(r => ({
          ...r,
          customer_name: r.customer_name && String(r.customer_name).trim() && String(r.customer_name) !== "0"
            ? String(r.customer_name).trim()
            : `عميل ${r.plate || r.claim_ref}`,
        }))
        .filter(r => r.claim_ref && r.plate);
      const itemRows: ItemRow[] = itemsSheet
        ? XLSX.utils.sheet_to_json<any>(itemsSheet, { defval: "" })
            .map(r => mapRow<ItemRow>(r, HEADER_MAP_ITEM))
            .filter(r => r.claim_ref && r.description)
        : [];
      const payRows: PaymentRow[] = paySheet
        ? XLSX.utils.sheet_to_json<any>(paySheet, { defval: "" })
            .map(r => mapRow<PaymentRow>(r, HEADER_MAP_PAY))
            .filter(r => r.claim_ref && r.amount)
        : [];

      log("info", `تم القراءة: ${claimRows.length} مطالبة، ${itemRows.length} بند، ${payRows.length} دفعة`);

      // Cache existing customers/vehicles
      const tenantId = profile.tenant_id;
      const refToClaimId: Record<string, string> = {};
      const refToCompany: Record<string, { id: string | null; name: string }> = {};

      // ── فحص التكرارات داخل الملف نفسه (نفس claim_ref أو نفس claim_number)
      const seenRef = new Set<string>();
      const seenNum = new Set<string>();
      const dedupedRows: ClaimRow[] = [];
      for (const r of claimRows) {
        if (seenRef.has(r.claim_ref)) {
          duplicatesCount++; dupList.push(`مكرر داخل الملف: ${r.claim_ref}`);
          log("err", `Duplicate row inside file: claim_ref=${r.claim_ref} - skipped`);
          continue;
        }
        if (r.claim_number && seenNum.has(r.claim_number)) {
          duplicatesCount++; dupList.push(`رقم مطالبة مكرر داخل الملف: ${r.claim_number}`);
          log("err", `Duplicate claim number inside file: ${r.claim_number} - skipped`);
          continue;
        }
        seenRef.add(r.claim_ref);
        if (r.claim_number) seenNum.add(r.claim_number);
        dedupedRows.push(r);
      }

      // ── فحص التكرار مع قاعدة البيانات (نفس claim_number لنفس tenant)
      const existingNums = new Set<string>();
      const numbersToCheck = dedupedRows.map(r => r.claim_number).filter(Boolean) as string[];
      if (numbersToCheck.length) {
        const { data: existing } = await supabase
          .from("insurance_claims" as any)
          .select("claim_number")
          .eq("tenant_id", tenantId)
          .in("claim_number", numbersToCheck);
        (existing as any[] | null)?.forEach((c: any) => existingNums.add(c.claim_number));
      }

      const finalRows = dedupedRows.filter(r => {
        if (r.claim_number && existingNums.has(r.claim_number)) {
          duplicatesCount++; dupList.push(`موجود مسبقاً: ${r.claim_number}`);
          log("err", `Claim already exists in the system: ${r.claim_number} - skipped`);
          return false;
        }
        return true;
      });

      for (let i = 0; i < finalRows.length; i++) {
        const r = finalRows[i];
        setProgress(Math.round(((i + 1) / Math.max(finalRows.length, 1)) * 70));
        try {
          const phoneStr = r.customer_phone && String(r.customer_phone).trim() && String(r.customer_phone) !== "0"
            ? String(r.customer_phone).trim() : null;
          // 1. Customer (by phone or name)
          let customerId: string | null = null;
          if (phoneStr) {
            const { data } = await supabase.from("customers").select("id")
              .eq("tenant_id", tenantId).eq("phone", phoneStr).maybeSingle();
            customerId = data?.id ?? null;
          }
          if (!customerId) {
            const { data } = await supabase.from("customers").select("id")
              .eq("tenant_id", tenantId).ilike("name", r.customer_name).maybeSingle();
            customerId = data?.id ?? null;
          }
          if (!customerId) {
            const { data, error } = await supabase.from("customers").insert({
              tenant_id: tenantId,
              name: r.customer_name,
              phone: phoneStr,
            }).select("id").single();
            if (error) throw error;
            customerId = data.id;
          }

          // 2. Vehicle (by plate via split RPC, then customer fallback)
          let vehicleId: string | null = null;
          {
            const { extractPlateLetters, extractPlateDigits, findVehicleByPlate } = await import("@/lib/plateUtils");
            const L = extractPlateLetters(String(r.plate));
            const D = extractPlateDigits(String(r.plate));
            if (L && D) {
              const found = await findVehicleByPlate(L, D, "OM");
              if (found?.id) vehicleId = found.id;
            }
            if (!vehicleId) {
              const { data, error } = await supabase.from("vehicles").insert({
                tenant_id: tenantId, customer_id: customerId,
                brand: r.brand || "غير محدد", model: r.model || "غير محدد",
                plate_number: D || String(r.plate),
                plate_letters: L,
                plate_country: "OM",
                year: r.year ? Number(r.year) : null,
                color: r.color || null, vin_number: r.vin || null,
              }).select("id").single();
              if (error) throw error;
              vehicleId = data.id;
            }
          }

          // 3. Insurance company (find or create)
          let companyId: string | null = null;
          {
            const { data } = await supabase.from("insurance_companies").select("id")
              .eq("tenant_id", tenantId).ilike("name", r.insurance_company).maybeSingle();
            companyId = data?.id ?? null;
          }
          if (!companyId) {
            const { data, error } = await supabase.from("insurance_companies").insert({
              tenant_id: tenantId, name: r.insurance_company,
            }).select("id").single();
            if (error) throw error;
            companyId = data.id;
          }
          refToCompany[r.claim_ref] = { id: companyId, name: r.insurance_company };

          // 4. Insurance claim
          const claimDate = toIso(r.claim_date) ?? new Date().toISOString().slice(0,10);
          const status = (r.status || "pending").toLowerCase();
          const validStatus = ["pending","approved","rejected","paid","cancelled"].includes(status) ? status : "pending";

          const claimNumber = r.claim_number || `IMP-${r.claim_ref}-${Date.now().toString(36)}`;
          const { data: claimData, error: claimErr } = await supabase
            .from("insurance_claims" as any)
            .insert({
              tenant_id: tenantId,
              customer_id: customerId,
              vehicle_id: vehicleId,
              claim_number: claimNumber,
              insurance_company: r.insurance_company,
              insurance_company_id: companyId,
              estimated_amount: num(r.estimated_amount),
              approved_amount: num(r.approved_amount, num(r.estimated_amount)),
              status: validStatus,
              notes: r.notes || null,
              policy_number: r.policy_number || null,
              deductible_amount: 0,
              vehicle_make: r.brand, vehicle_model: r.model, vehicle_plate: String(r.plate),
              vehicle_year: r.year ? Number(r.year) : null, vehicle_color: r.color || null,
              created_at: claimDate + "T00:00:00Z",
              approved_at: validStatus === "approved" || validStatus === "paid" ? claimDate + "T00:00:00Z" : null,
              paid_at: validStatus === "paid" ? claimDate + "T00:00:00Z" : null,
            } as any)
            .select("id")
            .single();
          if (claimErr) throw claimErr;
          refToClaimId[r.claim_ref] = (claimData as any).id;
          claimsCount++;
          log("ok", `✓ مطالبة ${claimNumber}`);
        } catch (e: any) {
          errors++;
          log("err", `✗ صف ${r.claim_ref}: ${e.message}`);
        }
      }

      // 5. Invoices (group items by claim_ref)
      setProgress(75);
      const grouped: Record<string, ItemRow[]> = {};
      for (const it of itemRows) {
        (grouped[it.claim_ref] ||= []).push(it);
      }
      const claimDateMap: Record<string, string> = {};
      claimRows.forEach(r => { claimDateMap[r.claim_ref] = toIso(r.claim_date) ?? new Date().toISOString().slice(0,10); });

      // Auto-create invoice for claims without explicit items if they have an approved/total amount
      const claimAmountMap: Record<string, { approved: number; totalWithVat: number }> = {};
      claimRows.forEach(r => {
        claimAmountMap[r.claim_ref] = {
          approved: num(r.approved_amount, num(r.estimated_amount)),
          totalWithVat: num(r.total_with_vat),
        };
      });
      for (const r of finalRows) {
        if (!grouped[r.claim_ref] && (claimAmountMap[r.claim_ref].approved > 0 || claimAmountMap[r.claim_ref].totalWithVat > 0)) {
          const amt = claimAmountMap[r.claim_ref];
          // Explicit total_with_vat imports are split only when that column is provided; approved amounts remain VAT-exclusive.
          const breakdown = amt.totalWithVat > 0
            ? calculateVatInclusive(amt.totalWithVat)
            : calculateVatExclusive(amt.approved);
          const subtotal = breakdown.subtotalBeforeVat;
          const total = breakdown.totalIncludingVat;
          const vat = breakdown.vatAmount;
          grouped[r.claim_ref] = [{ claim_ref: r.claim_ref, description: "أعمال إصلاح حسب التقدير المعتمد", quantity: 1, unit_price: subtotal }];
          (claimAmountMap[r.claim_ref] as any)._override = { subtotal, vat, total };
        }
      }

      for (const ref of Object.keys(grouped)) {
        const claimId = refToClaimId[ref];
        if (!claimId) { log("err", `بنود فاتورة بدون مطالبة: ${ref}`); errors++; continue; }
        const items = grouped[ref].map(it => ({
          description: it.description,
          quantity: num(it.quantity, 1),
          unit_price: num(it.unit_price),
        }));
        const override = (claimAmountMap[ref] as any)?._override;
        const subtotal = override?.subtotal ?? items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
        const vat = override?.vat ?? +(subtotal * 0.05).toFixed(3);
        const total = override?.total ?? +(subtotal + vat).toFixed(3);
        const company = refToCompany[ref];
        const issuedAt = claimDateMap[ref] + "T00:00:00Z";
        const { error } = await supabase.from("insurance_invoices" as any).insert({
          tenant_id: profile.tenant_id,
          claim_id: claimId,
          invoice_number: "",
          insurance_company_id: company?.id ?? null,
          insurance_company_name: company?.name ?? "",
          subtotal, vat, total,
          status: "issued",
          items,
          issued_at: issuedAt,
          created_at: issuedAt,
        } as any);
        if (error) { log("err", `فاتورة ${ref}: ${error.message}`); errors++; }
        else { invoicesCount++; log("ok", `✓ فاتورة ${ref}`); }
      }

      // 6. Payments
      setProgress(90);
      for (const p of payRows) {
        const claimId = refToClaimId[p.claim_ref];
        if (!claimId) { log("err", `دفعة بدون مطالبة: ${p.claim_ref}`); errors++; continue; }
        const method = ["bank_transfer","cheque","offset","cash"].includes(p.payment_method) ? p.payment_method : "bank_transfer";
        const date = toIso(p.payment_date) ?? new Date().toISOString().slice(0,10);
        const { error } = await supabase.from("claim_payments" as any).insert({
          tenant_id: profile.tenant_id,
          claim_id: claimId,
          insurance_company_id: refToCompany[p.claim_ref]?.id ?? null,
          payment_number: "",
          amount: num(p.amount),
          payment_method: method,
          status: method === "cheque" ? "pending" : "cleared",
          payment_date: date,
          reference_number: p.reference_number ? String(p.reference_number) : null,
          bank_name: p.bank_name || null,
          cheque_due_date: toIso(p.cheque_due_date),
          notes: p.notes || null,
          created_at: date + "T00:00:00Z",
        } as any);
        if (error) { log("err", `دفعة ${p.claim_ref}: ${error.message}`); errors++; }
        else { paymentsCount++; log("ok", `✓ دفعة ${p.claim_ref}`); }
      }

      setProgress(100);
      setDuplicates(dupList);
      setSummary({ claims: claimsCount, invoices: invoicesCount, payments: paymentsCount, errors, duplicates: duplicatesCount });
      if (duplicatesCount > 0) {
        toast.warning(`اكتمل الاستيراد مع تنبيه: ${duplicatesCount} مكرر تم تجاهله`, { duration: 8000 });
      } else {
        toast.success(`اكتمل الاستيراد — ${claimsCount} مطالبة، ${invoicesCount} فاتورة، ${paymentsCount} دفعة`);
      }
    } catch (e: any) {
      log("err", `فشل الاستيراد: ${e.message}`);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Upload className="text-primary" /> استيراد مطالبات Excel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ارفع ملف Excel لإنشاء مطالبات وفواتير ودفعات بالتواريخ الأصلية. سيتم إنشاء أوامر العمل تلقائياً عند اعتماد المطالبة.
          </p>
        </div>
        <Button variant="outline" onClick={downloadTemplate}>
          <Download className="ml-2 h-4 w-4" /> تنزيل القالب
        </Button>
      </div>

      <Card className="p-6">
        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
          <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
          <input
            id="xlsx-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label htmlFor="xlsx-input" className="cursor-pointer">
            <Button variant="secondary" asChild>
              <span>اختر ملف Excel</span>
            </Button>
          </label>
          {file && <div className="mt-3 text-sm">{file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
        </div>

        {file && (
          <div className="mt-4 flex justify-end">
            <Button onClick={handleImport} disabled={busy} size="lg">
              {busy ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" /> جارِ الاستيراد...</> : "بدء الاستيراد"}
            </Button>
          </div>
        )}

        {busy && (
          <div className="mt-4">
            <Progress value={progress} />
            <div className="text-xs text-muted-foreground mt-1">{progress}%</div>
          </div>
        )}
      </Card>

      {summary && (
        <Card className="p-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div><div className="text-2xl font-bold text-green-500">{summary.claims}</div><div className="text-xs text-muted-foreground">مطالبات</div></div>
            <div><div className="text-2xl font-bold text-blue-500">{summary.invoices}</div><div className="text-xs text-muted-foreground">فواتير</div></div>
            <div><div className="text-2xl font-bold text-purple-500">{summary.payments}</div><div className="text-xs text-muted-foreground">دفعات</div></div>
            <div><div className={`text-2xl font-bold ${summary.duplicates ? "text-amber-500" : "text-muted-foreground"}`}>{summary.duplicates}</div><div className="text-xs text-muted-foreground">مكررات</div></div>
            <div><div className={`text-2xl font-bold ${summary.errors ? "text-destructive" : "text-muted-foreground"}`}>{summary.errors}</div><div className="text-xs text-muted-foreground">أخطاء</div></div>
          </div>
        </Card>
      )}

      {duplicates.length > 0 && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/5">
          <div className="font-semibold mb-2 text-amber-600 flex items-center gap-2">
            <AlertCircle size={16} /> تنبيه: {duplicates.length} سجل مكرر تم تجاهله
          </div>
          <ScrollArea className="h-40">
            <div className="space-y-1 text-sm">
              {duplicates.map((d, i) => (
                <div key={i} className="text-amber-700 dark:text-amber-400">• {d}</div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}

      {logs.length > 0 && (
        <Card className="p-4">
          <div className="font-semibold mb-2">سجل العمليات</div>
          <ScrollArea className="h-64">
            <div className="space-y-1 text-sm font-mono">
              {logs.map((l, i) => (
                <div key={i} className={`flex items-start gap-2 ${
                  l.kind === "ok" ? "text-green-600" : l.kind === "err" ? "text-destructive" : "text-muted-foreground"
                }`}>
                  {l.kind === "ok" ? <CheckCircle2 size={14} className="mt-0.5" /> :
                    l.kind === "err" ? <AlertCircle size={14} className="mt-0.5" /> : <span className="w-3.5" />}
                  <span>{l.msg}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
