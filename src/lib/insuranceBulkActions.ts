// إجراءات جماعية للمطالبات — فوترة + تغيير حالات + تحقق ذكي
// Single Source of Truth: يحترم القاعدة "فاتورة واحدة فقط لكل مطالبة" عبر useCreateInsuranceInvoice
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";

const VAT_RATE = 0.05;

export interface BulkInvoiceReport {
  created: number;
  skipped: Array<{ claim_number: string; reason: string }>;
  errors: Array<{ claim_number: string; error: string }>;
}

/**
 * تحقق ذكي: هل المطالبة جاهزة لإصدار فاتورة ضريبية؟
 * - حالة = delivered
 * - مبلغ معتمد > 0
 * - بيانات العميل والمركبة موجودة
 */
export function validateClaimForInvoicing(c: InsuranceClaim): string | null {
  const isDelivered = !!(c as any).delivered_at;
  if (!isDelivered) return "لم تُسلَّم بعد";
  const amount = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
  if (amount <= 0) return "لا يوجد مبلغ معتمد";
  if (!c.customer_id) return "بيانات العميل ناقصة";
  const make = (c as any).vehicle_make ?? c.vehicle?.brand;
  const plate = (c as any).vehicle_plate ?? c.vehicle?.plate_number;
  if (!make || !plate) return "بيانات المركبة ناقصة";
  return null;
}

/**
 * إنشاء فاتورة ضريبية منفصلة لكل مطالبة محددة.
 * تاريخ الإصدار = تاريخ تسليم المطالبة الأصلي (للمطالبات القديمة).
 */
export async function bulkCreateSeparateInvoices(
  claims: InsuranceClaim[],
  tenantId: string,
): Promise<BulkInvoiceReport> {
  const report: BulkInvoiceReport = { created: 0, skipped: [], errors: [] };

  for (const claim of claims) {
    const invalidReason = validateClaimForInvoicing(claim);
    if (invalidReason) {
      report.skipped.push({ claim_number: claim.claim_number, reason: invalidReason });
      continue;
    }

    // فحص تكرار: هل توجد فاتورة نشطة لهذه المطالبة؟
    const { data: existing } = await supabase
      .from("insurance_invoices" as any)
      .select("id, invoice_number")
      .eq("claim_id", claim.id)
      .neq("status", "cancelled")
      .maybeSingle();
    if (existing) {
      report.skipped.push({
        claim_number: claim.claim_number,
        reason: `فاتورة موجودة #${(existing as any).invoice_number}`,
      });
      continue;
    }

    const amount = Number(claim.approved_amount) || Number(claim.estimated_amount) || 0;
    const subtotal = amount;
    const vat = +(subtotal * VAT_RATE).toFixed(3);
    const total = +(subtotal + vat).toFixed(3);
    // تاريخ التسليم الأصلي للمطالبة (الفواتير القديمة تأخذ تاريخها الفعلي)
    const issuedAt = (claim as any).delivered_at || claim.updated_at || new Date().toISOString();

    const idem = `claim:${claim.id}:total:${total.toFixed(2)}`;

    const { error } = await supabase.from("insurance_invoices" as any).insert({
      tenant_id: tenantId,
      claim_id: claim.id,
      insurance_company_id: claim.insurance_company_id,
      insurance_company_name: claim.insurance_company,
      vehicle_make: (claim as any).vehicle_make ?? claim.vehicle?.brand ?? null,
      vehicle_model: (claim as any).vehicle_model ?? claim.vehicle?.model ?? null,
      vehicle_plate: (claim as any).vehicle_plate ?? claim.vehicle?.plate_number ?? null,
      subtotal,
      vat,
      total,
      paid_amount: 0,
      status: "issued",
      issued_at: issuedAt,
      idempotency_key: idem,
      invoice_number: "",
      items: [{
        description: `خدمات إصلاح بموجب المطالبة ${claim.claim_number}`,
        quantity: 1,
        unit_price: subtotal,
      }],
    } as any);

    if (error) {
      if ((error as any).code === "23505") {
        report.skipped.push({ claim_number: claim.claim_number, reason: "فاتورة مكررة" });
      } else {
        report.errors.push({ claim_number: claim.claim_number, error: error.message });
      }
      continue;
    }
    report.created++;
  }

  return report;
}

/** تحديث حالة عدة مطالبات دفعة واحدة. */
export async function bulkUpdateStatus(
  claimIds: string[],
  status: "pending" | "approved" | "rejected" | "paid" | "cancelled" | "delivered",
): Promise<{ updated: number; errors: number }> {
  const now = new Date().toISOString();
  // Pseudo-status "delivered" → set delivered_at while keeping main status as approved
  if (status === "delivered") {
    const { error, count } = await supabase
      .from("insurance_claims" as any)
      .update({ delivered_at: now, updated_at: now }, { count: "exact" })
      .in("id", claimIds);
    if (error) {
      toast.error(error.message);
      return { updated: 0, errors: claimIds.length };
    }
    return { updated: count ?? claimIds.length, errors: 0 };
  }

  const updates: any = { status };
  if (status === "approved") updates.approved_at = now;
  if (status === "paid") updates.paid_at = now;

  const { error, count } = await supabase
    .from("insurance_claims" as any)
    .update(updates, { count: "exact" })
    .in("id", claimIds);

  if (error) {
    toast.error(error.message);
    return { updated: 0, errors: claimIds.length };
  }
  return { updated: count ?? claimIds.length, errors: 0 };
}

/** أرشفة (إلغاء ناعم) — يعتمد على وضع الحالة = cancelled. */
export async function bulkArchive(claimIds: string[]) {
  return bulkUpdateStatus(claimIds, "cancelled");
}

// ============================================================
// Phase 2/3: Grouped invoicing, duplicates, CSV export, WhatsApp
// ============================================================

/**
 * إنشاء فاتورة جماعية واحدة لكل شركة تأمين (multi-line items).
 * يجمع المطالبات المؤهلة (delivered + لا فاتورة نشطة) ثم ينشئ فاتورة لكل شركة.
 */
export async function bulkCreateGroupedInvoices(
  claims: InsuranceClaim[],
  tenantId: string,
): Promise<BulkInvoiceReport> {
  const report: BulkInvoiceReport = { created: 0, skipped: [], errors: [] };
  // group by insurance company id (fallback by name)
  const groups = new Map<string, InsuranceClaim[]>();
  for (const c of claims) {
    const invalid = validateClaimForInvoicing(c);
    if (invalid) { report.skipped.push({ claim_number: c.claim_number, reason: invalid }); continue; }
    const key = c.insurance_company_id || `name:${c.insurance_company || "—"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  for (const [, group] of groups) {
    // Skip claims that already have active invoice
    const eligible: InsuranceClaim[] = [];
    for (const c of group) {
      const { data: existing } = await supabase
        .from("insurance_invoices" as any)
        .select("id, invoice_number")
        .eq("claim_id", c.id)
        .neq("status", "cancelled")
        .maybeSingle();
      if (existing) {
        report.skipped.push({ claim_number: c.claim_number, reason: `فاتورة موجودة #${(existing as any).invoice_number}` });
      } else eligible.push(c);
    }
    if (!eligible.length) continue;

    const items = eligible.map((c) => {
      const amt = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
      const plate = (c as any).vehicle_plate ?? c.vehicle?.plate_number ?? "";
      return {
        description: `مطالبة ${c.claim_number}${plate ? ` — ${plate}` : ""}`,
        quantity: 1,
        unit_price: amt,
      };
    });
    const subtotal = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const vat = +(subtotal * VAT_RATE).toFixed(3);
    const total = +(subtotal + vat).toFixed(3);
    // Latest delivery date in the group
    const issuedAt = eligible
      .map((c) => (c as any).delivered_at)
      .filter(Boolean)
      .sort()
      .pop() || new Date().toISOString();

    const first = eligible[0];
    const idem = `group:${first.insurance_company_id || first.insurance_company}:${eligible.map((c) => c.id).sort().join(",")}:${total.toFixed(2)}`;

    // Grouped invoice is linked to the *first* claim (Supabase schema requires single claim_id).
    const { error } = await supabase.from("insurance_invoices" as any).insert({
      tenant_id: tenantId,
      claim_id: first.id,
      insurance_company_id: first.insurance_company_id,
      insurance_company_name: first.insurance_company,
      vehicle_make: null,
      vehicle_model: null,
      vehicle_plate: `جماعي · ${eligible.length} مطالبة`,
      subtotal,
      vat,
      total,
      paid_amount: 0,
      status: "issued",
      issued_at: issuedAt,
      idempotency_key: idem,
      invoice_number: "",
      items,
      notes: `فاتورة جماعية لمطالبات: ${eligible.map((c) => c.claim_number).join(", ")}`,
    } as any);

    if (error) {
      if ((error as any).code === "23505") {
        eligible.forEach((c) => report.skipped.push({ claim_number: c.claim_number, reason: "فاتورة جماعية مكررة" }));
      } else {
        eligible.forEach((c) => report.errors.push({ claim_number: c.claim_number, error: error.message }));
      }
      continue;
    }
    report.created++; // counts the grouped invoice
  }

  return report;
}

/** كشف التكرار بين المطالبات المحددة (نفس مركبة + نفس شركة تأمين + تاريخ متقارب). */
export function bulkDetectDuplicates(claims: InsuranceClaim[]): Array<{ key: string; claims: InsuranceClaim[] }> {
  const map = new Map<string, InsuranceClaim[]>();
  for (const c of claims) {
    const plate = ((c as any).vehicle_plate ?? c.vehicle?.plate_number ?? "").trim().toLowerCase();
    const company = (c.insurance_company_id || c.insurance_company || "").trim().toLowerCase();
    const day = (c.incident_date || c.created_at || "").slice(0, 10);
    if (!plate || !company) continue;
    const key = `${plate}|${company}|${day}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return Array.from(map.entries())
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({ key, claims: arr }));
}

/** تصدير المطالبات المحددة إلى CSV (يتعامل مع Excel بدعم BOM). */
export function bulkExportClaimsCSV(claims: InsuranceClaim[]) {
  const headers = [
    "claim_number", "insurance_company", "customer", "plate", "make", "model",
    "estimated_amount", "approved_amount", "status", "delivered_at", "incident_date", "created_at",
  ];
  const rows = claims.map((c) => [
    c.claim_number,
    c.insurance_company || "",
    c.customer?.name || "",
    (c as any).vehicle_plate || c.vehicle?.plate_number || "",
    (c as any).vehicle_make || c.vehicle?.brand || "",
    (c as any).vehicle_model || c.vehicle?.model || "",
    c.estimated_amount ?? 0,
    c.approved_amount ?? 0,
    c.status,
    (c as any).delivered_at || "",
    c.incident_date || "",
    c.created_at,
  ]);
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `claims-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`تم تصدير ${claims.length} مطالبة`);
}

/** إرسال الرسائل تباعاً عبر Edge Function مع ربطها بالمطالبة. */
export async function bulkOpenWhatsAppToCustomers(
  claims: InsuranceClaim[],
  buildMessage: (c: InsuranceClaim) => string,
) {
  let opened = 0;
  let skipped = 0;
  for (const c of claims) {
    const phone = (c.customer?.phone || "").replace(/\D/g, "");
    if (!phone) { skipped++; continue; }
    try {
      await sendWhatsAppMessage({
        message: buildMessage(c),
        phone,
        insuranceClaimId: c.id,
        customerId: c.customer_id || undefined,
        recipientName: c.customer?.name,
        recipientType: "customer",
      });
      opened++;
    } catch {
      skipped++;
    }
  }
  if (opened) toast.success(`تم إرسال ${opened} رسالة واتساب`);
  if (skipped) toast.warning(`تم تخطي ${skipped} مطالبة بدون رقم هاتف`);
}

/** عرض ملخّص تقرير الفوترة كـ toast واحد. */
export function reportInvoicingResult(report: BulkInvoiceReport) {
  const parts: string[] = [];
  if (report.created) parts.push(`✅ تم إصدار ${report.created} فاتورة`);
  if (report.skipped.length) parts.push(`⏭️ تم تخطي ${report.skipped.length}`);
  if (report.errors.length) parts.push(`❌ ${report.errors.length} أخطاء`);
  const msg = parts.join(" · ") || "لم يتم إصدار أي فاتورة";

  if (report.created > 0) {
    toast.success(msg, {
      description: report.skipped.length
        ? `مُتخطى: ${report.skipped.slice(0, 3).map((s) => `${s.claim_number} (${s.reason})`).join("، ")}${report.skipped.length > 3 ? "..." : ""}`
        : undefined,
      duration: 6000,
    });
  } else {
    toast.warning(msg, {
      description: report.skipped.length
        ? report.skipped.slice(0, 3).map((s) => `${s.claim_number}: ${s.reason}`).join("\n")
        : undefined,
      duration: 6000,
    });
  }
}
