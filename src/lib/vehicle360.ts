import { supabase } from "@/integrations/supabase/client";
import { roundMoney } from "@/lib/money";

type Row = Record<string, any>;

export type VehicleTimelineCategory =
  | "vehicle"
  | "entry"
  | "work_order"
  | "claim"
  | "parts"
  | "expense"
  | "invoice"
  | "payment"
  | "media"
  | "delivery"
  | "audit";

export interface VehicleTimelineEvent {
  id: string;
  category: VehicleTimelineCategory;
  occurredAt: string;
  titleAr: string;
  titleEn: string;
  detailAr?: string;
  detailEn?: string;
  amount?: number;
  status?: string | null;
  actor?: string | null;
  href?: string | null;
  sourceId?: string | null;
}

export interface VehicleFinancialSummary {
  cashBilled: number;
  insuranceBilled: number;
  totalBilled: number;
  cashCollected: number;
  insuranceCollected: number;
  totalCollected: number;
  expenses: number;
  partsExpenses: number;
  otherExpenses: number;
  invoiceMargin: number;
  cashflowMargin: number;
  outstanding: number;
}

export interface Vehicle360Snapshot {
  vehicleId: string;
  workOrders: Row[];
  claims: Row[];
  entries: Row[];
  handovers: Row[];
  expenses: Row[];
  parts: Row[];
  cashInvoices: Row[];
  insuranceInvoices: Row[];
  cashPayments: Row[];
  insurancePayments: Row[];
  media: Row[];
  auditLogs: Row[];
  tracking: { count: number; lastOpenedAt: string | null };
  timeline: VehicleTimelineEvent[];
  financial: VehicleFinancialSummary;
  activeWorkOrder: Row | null;
  activeClaim: Row | null;
  currentPresence: string;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
}

function uniqueRows(rows: Row[]) {
  return Array.from(new Map(rows.filter(Boolean).map((row) => [String(row.id), row])).values());
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function activeRecord(row: Row) {
  const status = String(row.status || row.invoice_status || "").toLowerCase();
  return !row.deleted_at && !row.archived_at && !["cancelled", "canceled", "void", "rejected", "draft"].includes(status);
}

function event(input: VehicleTimelineEvent) {
  return input.occurredAt ? input : null;
}

function claimEvents(claim: Row): Array<VehicleTimelineEvent | null> {
  const base = `/insurance/${claim.id}`;
  const label = claim.claim_number || claim.id;
  return [
    event({ id: `claim-created-${claim.id}`, category: "claim", occurredAt: claim.created_at, titleAr: "إنشاء مطالبة تأمين", titleEn: "Insurance claim created", detailAr: `المطالبة ${label} — ${claim.insurance_company || ""}`, detailEn: `Claim ${label} — ${claim.insurance_company || ""}`, status: claim.status, href: base, sourceId: claim.id }),
    claim.vehicle_received_at || claim.workshop_arrival_date ? event({ id: `claim-received-${claim.id}`, category: "entry", occurredAt: claim.vehicle_received_at || claim.workshop_arrival_date, titleAr: "استلام المركبة في الورشة", titleEn: "Vehicle received at workshop", detailAr: `المطالبة ${label}`, detailEn: `Claim ${label}`, href: base, sourceId: claim.id }) : null,
    claim.insurance_approved_at || claim.approved_at ? event({ id: `claim-approved-${claim.id}`, category: "claim", occurredAt: claim.insurance_approved_at || claim.approved_at, titleAr: "اعتماد مطالبة التأمين", titleEn: "Insurance claim approved", detailAr: `المبلغ المعتمد ${Number(claim.approved_amount || claim.lpo_amount || 0).toFixed(3)} ر.ع`, detailEn: `Approved amount OMR ${Number(claim.approved_amount || claim.lpo_amount || 0).toFixed(3)}`, amount: Number(claim.approved_amount || claim.lpo_amount || 0), status: claim.status, href: base, sourceId: claim.id }) : null,
    claim.work_started_at || claim.repair_started_at ? event({ id: `claim-started-${claim.id}`, category: "work_order", occurredAt: claim.work_started_at || claim.repair_started_at, titleAr: "بدء أعمال الإصلاح", titleEn: "Repair work started", detailAr: `المطالبة ${label}`, detailEn: `Claim ${label}`, href: base, sourceId: claim.id }) : null,
    claim.work_completed_at ? event({ id: `claim-completed-${claim.id}`, category: "work_order", occurredAt: claim.work_completed_at, titleAr: "اكتمال أعمال الإصلاح", titleEn: "Repair work completed", detailAr: `المطالبة ${label}`, detailEn: `Claim ${label}`, href: base, sourceId: claim.id }) : null,
    claim.vehicle_delivered_at || claim.delivered_at ? event({ id: `claim-delivered-${claim.id}`, category: "delivery", occurredAt: claim.vehicle_delivered_at || claim.delivered_at, titleAr: "تسليم المركبة", titleEn: "Vehicle delivered", detailAr: `المطالبة ${label}`, detailEn: `Claim ${label}`, status: claim.status, href: base, sourceId: claim.id }) : null,
  ];
}

export function buildVehicleTimeline(snapshot: Omit<Vehicle360Snapshot, "timeline" | "financial" | "activeWorkOrder" | "activeClaim" | "currentPresence" | "firstVisitAt" | "lastVisitAt">): VehicleTimelineEvent[] {
  const events: Array<VehicleTimelineEvent | null> = [];
  for (const entry of snapshot.entries) {
    events.push(event({ id: `entry-${entry.id}`, category: "entry", occurredAt: `${entry.arrival_date || entry.created_at}${entry.arrival_time ? `T${entry.arrival_time}` : ""}`, titleAr: "دخول واستلام المركبة", titleEn: "Vehicle entry and receipt", detailAr: `${entry.entry_number || ""}${entry.arrival_method ? ` — ${entry.arrival_method}` : ""}`, detailEn: `${entry.entry_number || ""}${entry.arrival_method ? ` — ${entry.arrival_method}` : ""}`, status: entry.status, href: `/vehicle-entry/${entry.id}`, sourceId: entry.id }));
  }
  for (const order of snapshot.workOrders) {
    const href = `/work-orders/${encodeURIComponent(order.order_number || order.id)}`;
    const label = order.order_number || order.id;
    events.push(event({ id: `wo-created-${order.id}`, category: "work_order", occurredAt: order.entry_date || order.received_at || order.created_at, titleAr: "فتح أمر عمل", titleEn: "Work order opened", detailAr: `${label}${order.service_type ? ` — ${order.service_type}` : ""}`, detailEn: `${label}${order.service_type ? ` — ${order.service_type}` : ""}`, amount: Number(order.final_total || 0), status: order.status, actor: order.technician_name, href, sourceId: order.id }));
    if (order.work_started_at) events.push(event({ id: `wo-start-${order.id}`, category: "work_order", occurredAt: order.work_started_at, titleAr: "بدء العمل الفعلي", titleEn: "Repair work started", detailAr: label, detailEn: label, status: order.status, href, sourceId: order.id }));
    if (order.work_completed_at || order.completed_at) events.push(event({ id: `wo-complete-${order.id}`, category: "work_order", occurredAt: order.work_completed_at || order.completed_at, titleAr: "إنجاز أمر العمل", titleEn: "Work order completed", detailAr: label, detailEn: label, status: order.status, href, sourceId: order.id }));
    if (order.vehicle_delivered_at) events.push(event({ id: `wo-delivery-${order.id}`, category: "delivery", occurredAt: order.vehicle_delivered_at, titleAr: "تسليم المركبة من أمر العمل", titleEn: "Vehicle delivered from work order", detailAr: label, detailEn: label, status: order.status, href, sourceId: order.id }));
  }
  snapshot.claims.forEach((claim) => events.push(...claimEvents(claim)));
  for (const handover of snapshot.handovers) {
    events.push(event({ id: `handover-${handover.id}`, category: "delivery", occurredAt: handover.finalized_at || handover.cancelled_at || handover.delivered_at || handover.created_at, titleAr: handover.status === "cancelled" ? "إلغاء تسليم المركبة" : "اعتماد إقرار تسليم المركبة", titleEn: handover.status === "cancelled" ? "Vehicle delivery cancelled" : "Vehicle handover finalized", detailAr: handover.cancellation_reason || handover.recipient_name || handover.receipt_number || "", detailEn: handover.cancellation_reason || handover.recipient_name || handover.receipt_number || "", status: handover.status, sourceId: handover.id }));
  }
  for (const expense of snapshot.expenses) {
    events.push(event({ id: `expense-${expense.id}`, category: "expense", occurredAt: expense.date || expense.created_at, titleAr: "تسجيل مصروف على المركبة", titleEn: "Vehicle expense recorded", detailAr: expense.description || expense.category_name || expense.voucher_number || "", detailEn: expense.description || expense.category_name || expense.voucher_number || "", amount: Number(expense.total || expense.amount || 0), status: expense.status, href: `/accounting/expenses/${expense.id}/edit`, sourceId: expense.id }));
  }
  for (const part of snapshot.parts) {
    events.push(event({ id: `part-${part.id}`, category: "parts", occurredAt: part.created_at, titleAr: "إضافة قطعة غيار", titleEn: "Spare part added", detailAr: part.inventory?.name || "قطعة غيار", detailEn: part.inventory?.name || "Spare part", amount: Number(part.total_price || (part.quantity || 0) * (part.unit_price || 0)), sourceId: part.id }));
  }
  for (const invoice of snapshot.cashInvoices) {
    events.push(event({ id: `cash-invoice-${invoice.id}`, category: "invoice", occurredAt: invoice.issued_at || invoice.date || invoice.created_at, titleAr: "إصدار فاتورة كاش", titleEn: "Cash invoice issued", detailAr: invoice.doc_number, detailEn: invoice.doc_number, amount: Number(invoice.total || 0), status: invoice.status, href: `/sales/invoices/${invoice.id}`, sourceId: invoice.id }));
  }
  for (const invoice of snapshot.insuranceInvoices) {
    events.push(event({ id: `insurance-invoice-${invoice.id}`, category: "invoice", occurredAt: invoice.issued_at || invoice.invoice_date || invoice.created_at, titleAr: "إصدار فاتورة تأمين", titleEn: "Insurance invoice issued", detailAr: invoice.invoice_number, detailEn: invoice.invoice_number, amount: Number(invoice.total || 0), status: invoice.status, href: invoice.claim_id ? `/insurance/${invoice.claim_id}` : null, sourceId: invoice.id }));
  }
  for (const payment of snapshot.cashPayments) {
    events.push(event({ id: `cash-payment-${payment.id}`, category: "payment", occurredAt: payment.date || payment.created_at, titleAr: "استلام دفعة كاش", titleEn: "Cash payment received", detailAr: payment.payment_number || payment.reference || "", detailEn: payment.payment_number || payment.reference || "", amount: Number(payment.amount || 0), href: `/sales/invoices/${payment.sales_document_id}`, sourceId: payment.id }));
  }
  for (const payment of snapshot.insurancePayments) {
    events.push(event({ id: `claim-payment-${payment.id}`, category: "payment", occurredAt: payment.payment_date || payment.created_at, titleAr: "استلام دفعة تأمين", titleEn: "Insurance payment received", detailAr: payment.payment_number || payment.reference_number || "", detailEn: payment.payment_number || payment.reference_number || "", amount: Number(payment.amount || 0), status: payment.status, href: payment.claim_id ? `/insurance/${payment.claim_id}` : null, sourceId: payment.id }));
  }
  for (const media of snapshot.media) {
    events.push(event({ id: `media-${media.id}`, category: "media", occurredAt: media.uploaded_at || media.created_at, titleAr: media.media_type === "document" ? "رفع مستند" : "رفع صورة للمركبة", titleEn: media.media_type === "document" ? "Document uploaded" : "Vehicle photo uploaded", detailAr: media.caption || media.file_name || media.category || "", detailEn: media.caption || media.file_name || media.category || "", sourceId: media.id }));
  }
  for (const audit of snapshot.auditLogs) {
    events.push(event({ id: `audit-${audit.id}`, category: "audit", occurredAt: audit.created_at, titleAr: audit.action || "تحديث سجل المركبة", titleEn: audit.action || "Vehicle record updated", detailAr: audit.category || "", detailEn: audit.category || "", actor: audit.user_id, href: audit.claim_id ? `/insurance/${audit.claim_id}/audit` : null, sourceId: audit.id }));
  }
  return events.filter((item): item is VehicleTimelineEvent => Boolean(item?.occurredAt))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

export function calculateVehicleFinancials(input: Pick<Vehicle360Snapshot, "cashInvoices" | "insuranceInvoices" | "cashPayments" | "insurancePayments" | "expenses">): VehicleFinancialSummary {
  const cashBilled = input.cashInvoices.filter(activeRecord).reduce((sum, row) => sum + Number(row.total || 0), 0);
  const insuranceBilled = input.insuranceInvoices.filter(activeRecord).reduce((sum, row) => sum + Number(row.total || 0), 0);
  const cashCollected = input.cashPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const insuranceCollected = input.insurancePayments.filter((row) => String(row.status || "").toLowerCase() === "cleared").reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expenseRows = input.expenses.filter(activeRecord);
  const expenses = expenseRows.reduce((sum, row) => sum + Number(row.total || row.amount || 0), 0);
  const partsExpenses = expenseRows.filter((row) => /part|spare|قطع/i.test(`${row.expense_type || ""} ${row.category_name || ""} ${row.description || ""}`)).reduce((sum, row) => sum + Number(row.total || row.amount || 0), 0);
  const totalBilled = cashBilled + insuranceBilled;
  const totalCollected = cashCollected + insuranceCollected;
  return {
    cashBilled: roundMoney(cashBilled), insuranceBilled: roundMoney(insuranceBilled), totalBilled: roundMoney(totalBilled),
    cashCollected: roundMoney(cashCollected), insuranceCollected: roundMoney(insuranceCollected), totalCollected: roundMoney(totalCollected),
    expenses: roundMoney(expenses), partsExpenses: roundMoney(partsExpenses), otherExpenses: roundMoney(expenses - partsExpenses),
    invoiceMargin: roundMoney(totalBilled - expenses), cashflowMargin: roundMoney(totalCollected - expenses),
    outstanding: roundMoney(Math.max(0, totalBilled - totalCollected)),
  };
}

async function rows(result: PromiseLike<{ data: any; error: any }>, missingTable?: string): Promise<Row[]> {
  const { data, error } = await result;
  if (error) {
    const message = String(error.message || error.details || "");
    if (missingTable && message.toLowerCase().includes(missingTable.toLowerCase()) && /schema cache|does not exist|could not find/i.test(message)) return [];
    throw error;
  }
  return (data || []) as Row[];
}

export async function fetchVehicle360Snapshot(tenantId: string, vehicleId: string, plate: string): Promise<Vehicle360Snapshot> {
  if (!tenantId || !vehicleId) throw new Error("vehicle_360_identity_required");
  const [workOrders, claims, entries, handovers, directExpenses, mediaByVehicle, auditLogs, trackingCount, trackingLatest] = await Promise.all([
    rows((supabase.from("job_orders") as any).select("id,order_number,status,work_order_type,service_type,entry_date,received_at,created_at,updated_at,work_started_at,work_completed_at,completed_at,vehicle_delivered_at,vehicle_presence_status,technician_name,diagnosis,description,labor_cost,parts_cost,final_total,claim_id,insurance_claim_number,insurance_company,archived_at,deleted_at,visit_number,vehicle_entry_id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false })),
    rows((supabase.from("insurance_claims") as any).select("id,claim_number,status,insurance_company,insurance_company_id,created_at,updated_at,vehicle_received_at,workshop_arrival_date,insurance_approved_at,approved_at,approved_amount,lpo_amount,lpo_number,work_started_at,repair_started_at,work_completed_at,vehicle_delivered_at,delivered_at,vehicle_presence_status,repair_stage,job_order_id,auto_job_order_id,deleted_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false })),
    rows((supabase.from("vehicle_entries") as any).select("id,entry_number,status,arrival_date,arrival_time,arrival_method,vehicle_location,vehicle_location_bay,received_by_name,insurance_claim_id,work_order_id,converted_claim_id,converted_work_order_id,created_at,updated_at,deleted_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("arrival_date", { ascending: false })),
    rows((supabase.from("vehicle_handover_records" as any) as any).select("id,receipt_number,status,work_order_id,claim_id,vehicle_id,delivered_at,finalized_at,cancelled_at,cancellation_reason,recipient_type,recipient_name,created_at,updated_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }), "vehicle_handover_records"),
    rows((supabase.from("expenses") as any).select("id,voucher_number,date,created_at,updated_at,status,expense_type,expense_scope,work_order_channel,description,category_name,total,amount,vat_amount,vehicle_id,linked_vehicle_plate,work_order_id,linked_work_order_id,claim_id,supplier_id,archived_at,deleted_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)),
    rows((supabase.from("vehicle_media") as any).select("id,media_type,category,caption,file_name,public_url,storage_bucket,storage_path,stage,source,vehicle_id,work_order_id,claim_id,vehicle_entry_id,uploaded_at,created_at,deleted_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).is("deleted_at", null).order("uploaded_at", { ascending: false })),
    rows((supabase.from("claim_audit_logs") as any).select("id,claim_id,vehicle_id,action,category,details,user_id,created_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(250)),
    // public_tracking_logs intentionally has no tenant_id column. The vehicle
    // UUID is the scoped reference exposed by its RLS policy, so adding a
    // tenant filter here causes a Production HTTP 400 and aborts the snapshot.
    (supabase.from("public_tracking_logs" as any) as any).select("id", { count: "exact", head: true }).eq("vehicle_id", vehicleId).eq("result", "success"),
    (supabase.from("public_tracking_logs" as any) as any).select("opened_at").eq("vehicle_id", vehicleId).eq("result", "success").order("opened_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (trackingCount.error && !/public_tracking_logs|schema cache|relation/i.test(String(trackingCount.error.message || ""))) throw trackingCount.error;
  if (trackingLatest.error && !/public_tracking_logs|schema cache|relation/i.test(String(trackingLatest.error.message || ""))) throw trackingLatest.error;

  const orderIds = uniqueStrings(workOrders.map((row) => row.id));
  const orderRefs = uniqueStrings(workOrders.flatMap((row) => [row.id, row.order_number]));
  const claimIds = uniqueStrings(claims.map((row) => row.id));
  const expensePromises: Promise<Row[]>[] = [];
  if (plate) expensePromises.push(rows((supabase.from("expenses") as any).select("*").eq("tenant_id", tenantId).eq("linked_vehicle_plate", plate)));
  if (orderRefs.length) {
    expensePromises.push(rows((supabase.from("expenses") as any).select("*").eq("tenant_id", tenantId).in("linked_work_order_id", orderRefs)));
    expensePromises.push(rows((supabase.from("expenses") as any).select("*").eq("tenant_id", tenantId).in("work_order_id", orderRefs)));
  }
  if (claimIds.length) expensePromises.push(rows((supabase.from("expenses") as any).select("*").eq("tenant_id", tenantId).in("claim_id", claimIds)));

  const [expenseGroups, parts, cashByWorkOrder, cashByPlate, insuranceInvoices, mediaByWorkOrder, mediaByClaim] = await Promise.all([
    Promise.all(expensePromises),
    orderIds.length ? rows((supabase.from("job_order_parts") as any).select("id,job_order_id,quantity,unit_price,total_price,created_at,inventory:inventory_id(name,part_number)").eq("tenant_id", tenantId).in("job_order_id", orderIds)) : Promise.resolve([]),
    orderRefs.length ? rows((supabase.from("sales_documents") as any).select("id,doc_number,status,invoice_status,date,issued_at,created_at,subtotal,tax_total,total,paid_amount,balance_due,work_order_id,vehicle_plate,deleted_at,archived_at").eq("tenant_id", tenantId).eq("doc_type", "invoice").in("work_order_id", orderRefs)) : Promise.resolve([]),
    plate ? rows((supabase.from("sales_documents") as any).select("id,doc_number,status,invoice_status,date,issued_at,created_at,subtotal,tax_total,total,paid_amount,balance_due,work_order_id,vehicle_plate,deleted_at,archived_at").eq("tenant_id", tenantId).eq("doc_type", "invoice").eq("vehicle_plate", plate)) : Promise.resolve([]),
    claimIds.length ? rows((supabase.from("insurance_invoices" as any) as any).select("id,claim_id,invoice_number,status,invoice_date,issued_at,created_at,subtotal,vat,total,paid_amount,last_payment_date,insurance_company_name,vehicle_plate").eq("tenant_id", tenantId).in("claim_id", claimIds)) : Promise.resolve([]),
    orderIds.length ? rows((supabase.from("vehicle_media") as any).select("*").eq("tenant_id", tenantId).in("work_order_id", orderIds).is("deleted_at", null)) : Promise.resolve([]),
    claimIds.length ? rows((supabase.from("vehicle_media") as any).select("*").eq("tenant_id", tenantId).in("claim_id", claimIds).is("deleted_at", null)) : Promise.resolve([]),
  ]);

  const expenses = uniqueRows([directExpenses, ...expenseGroups].flat());
  const cashInvoices = uniqueRows([...cashByWorkOrder, ...cashByPlate]);
  const media = uniqueRows([...mediaByVehicle, ...mediaByWorkOrder, ...mediaByClaim]);
  const cashInvoiceIds = uniqueStrings(cashInvoices.map((row) => row.id));
  const [cashPayments, insurancePayments] = await Promise.all([
    cashInvoiceIds.length ? rows((supabase.from("sales_payments") as any).select("id,sales_document_id,payment_number,date,created_at,amount,method,reference").eq("tenant_id", tenantId).in("sales_document_id", cashInvoiceIds)) : Promise.resolve([]),
    claimIds.length ? rows((supabase.from("claim_payments") as any).select("id,claim_id,payment_number,payment_date,created_at,amount,payment_method,reference_number,status").eq("tenant_id", tenantId).in("claim_id", claimIds)) : Promise.resolve([]),
  ]);

  const base = { vehicleId, workOrders, claims, entries, handovers, expenses, parts, cashInvoices, insuranceInvoices, cashPayments, insurancePayments, media, auditLogs, tracking: { count: Number(trackingCount.count || 0), lastOpenedAt: trackingLatest.data?.opened_at || null } };
  const timeline = buildVehicleTimeline(base);
  const financial = calculateVehicleFinancials(base);
  const closed = new Set(["delivered", "closed", "completed", "cancelled", "canceled", "rejected"]);
  const activeWorkOrder = workOrders.find((row) => !row.deleted_at && !closed.has(String(row.status || "").toLowerCase())) || null;
  const activeClaim = claims.find((row) => !row.deleted_at && !closed.has(String(row.status || "").toLowerCase())) || null;
  const presence = activeWorkOrder?.vehicle_presence_status || activeClaim?.vehicle_presence_status || (handovers[0]?.status === "finalized" ? "delivered" : "with_customer");
  const visitDates = uniqueStrings([...entries.map((row) => row.arrival_date), ...workOrders.map((row) => row.entry_date || row.received_at), ...claims.map((row) => row.vehicle_received_at || row.workshop_arrival_date)]).sort();
  return { ...base, timeline, financial, activeWorkOrder, activeClaim, currentPresence: presence, firstVisitAt: visitDates[0] || null, lastVisitAt: visitDates.at(-1) || null };
}
