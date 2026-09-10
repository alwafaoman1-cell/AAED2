import { supabase } from "@/integrations/supabase/client";
import { roundMoney } from "@/lib/money";

type Row = Record<string, any>;
const EXPENSE_SELECTION = "id,voucher_number,date,created_at,updated_at,status,expense_type,expense_scope,work_order_channel,description,category_name,total,subtotal,amount,vat_amount,vehicle_id,linked_vehicle_plate,work_order_id,linked_work_order_id,claim_id,supplier_id,archived_at,deleted_at";

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
  billedBeforeVat: number;
  vatTotal: number;
  directCostBeforeVat: number;
  externalLabor: number;
  actualProfit: number;
  profitMarginPct: number;
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
  estimates: Row[];
  signatures: Row[];
  communications: Row[];
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

function withVehicleContext(href: string, vehicleId: string) {
  return `${href}${href.includes("?") ? "&" : "?"}fromVehicle=${encodeURIComponent(vehicleId)}`;
}

function claimEvents(claim: Row, vehicleId: string): Array<VehicleTimelineEvent | null> {
  const base = `/insurance/${claim.id}`;
  const label = claim.claim_number || claim.id;
  return [
    event({ id: `claim-created-${claim.id}`, category: "claim", occurredAt: claim.created_at, titleAr: "إنشاء مطالبة تأمين", titleEn: "Insurance claim created", detailAr: `المطالبة ${label} — ${claim.insurance_company || ""}`, detailEn: `Claim ${label} — ${claim.insurance_company || ""}`, status: claim.status, href: withVehicleContext(base, vehicleId), sourceId: claim.id }),
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
  snapshot.claims.forEach((claim) => events.push(...claimEvents(claim, snapshot.vehicleId)));
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
  for (const estimate of snapshot.estimates || []) {
    events.push(event({ id: `estimate-${estimate.id}`, category: "claim", occurredAt: estimate.issued_at || estimate.estimate_date || estimate.created_at, titleAr: "إنشاء أو تحديث تقدير", titleEn: "Estimate created or updated", detailAr: estimate.estimate_number || estimate.legacy_number || "", detailEn: estimate.estimate_number || estimate.legacy_number || "", amount: Number(estimate.subtotal || estimate.total || estimate.lump_sum_amount || 0), status: estimate.status, href: estimate.claim_id ? `/insurance/${estimate.claim_id}` : null, sourceId: estimate.id }));
  }
  for (const signature of snapshot.signatures || []) {
    events.push(event({ id: `signature-${signature.id}`, category: "audit", occurredAt: signature.signed_at || signature.created_at || signature.finalized_at, titleAr: "توقيع مرتبط بالمركبة", titleEn: "Vehicle signature recorded", detailAr: signature.signer_name || signature.recipient_name || signature.signature_role || "", detailEn: signature.signer_name || signature.recipient_name || signature.signature_role || "", actor: signature.signed_by || signature.finalized_by, href: signature.vehicle_entry_id ? `/vehicle-entry/${signature.vehicle_entry_id}` : null, sourceId: signature.id }));
  }
  for (const communication of snapshot.communications || []) {
    events.push(event({ id: `communication-${communication.id}`, category: "audit", occurredAt: communication.sent_at || communication.created_at, titleAr: "مراسلة مرتبطة بالمركبة", titleEn: "Vehicle communication", detailAr: communication.subject || communication.body || communication.message || communication.event_type || "", detailEn: communication.subject || communication.body || communication.message || communication.event_type || "", status: communication.status, actor: communication.created_by || communication.user_id, href: communication.work_order_id ? `/work-orders/${communication.work_order_id}` : communication.claim_id ? `/insurance/${communication.claim_id}` : null, sourceId: communication.id }));
  }
  for (const audit of snapshot.auditLogs) {
    events.push(event({ id: `audit-${audit.id}`, category: "audit", occurredAt: audit.created_at, titleAr: audit.action || "تحديث سجل المركبة", titleEn: audit.action || "Vehicle record updated", detailAr: audit.category || "", detailEn: audit.category || "", actor: audit.user_id, href: audit.claim_id ? `/insurance/${audit.claim_id}/audit` : null, sourceId: audit.id }));
  }
  return events.filter((item): item is VehicleTimelineEvent => Boolean(item?.occurredAt))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

export function calculateVehicleFinancials(input: Pick<Vehicle360Snapshot, "cashInvoices" | "insuranceInvoices" | "cashPayments" | "insurancePayments" | "expenses">): VehicleFinancialSummary {
  const activeCashInvoices = input.cashInvoices.filter(activeRecord);
  const activeInsuranceInvoices = input.insuranceInvoices.filter(activeRecord);
  const cashBilled = activeCashInvoices.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const insuranceBilled = activeInsuranceInvoices.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const billedBeforeVat = activeCashInvoices.reduce((sum, row) => sum + Number(row.subtotal ?? (Number(row.total || 0) - Number(row.tax_total || 0))), 0)
    + activeInsuranceInvoices.reduce((sum, row) => sum + Number(row.subtotal ?? (Number(row.total || 0) - Number(row.vat || 0))), 0);
  const vatTotal = activeCashInvoices.reduce((sum, row) => sum + Number(row.tax_total || 0), 0)
    + activeInsuranceInvoices.reduce((sum, row) => sum + Number(row.vat || 0), 0);
  const cashCollected = input.cashPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const collectedStatuses = new Set(["cleared", "paid", "completed", "received"]);
  const insuranceCollected = input.insurancePayments.filter((row) => collectedStatuses.has(String(row.status || "").toLowerCase())).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const expenseRows = input.expenses.filter(activeRecord);
  const expenses = expenseRows.reduce((sum, row) => sum + Number(row.total || row.amount || 0), 0);
  const expenseNet = (row: Row) => Number(row.subtotal ?? (Number(row.total || row.amount || 0) - Number(row.vat_amount || 0)));
  const directCostBeforeVat = expenseRows.reduce((sum, row) => sum + expenseNet(row), 0);
  const partsExpenses = expenseRows.filter((row) => /part|spare|قطع/i.test(`${row.expense_type || ""} ${row.category_name || ""} ${row.description || ""}`)).reduce((sum, row) => sum + expenseNet(row), 0);
  const externalLabor = expenseRows.filter((row) => /external.?labou?r|subcontract|عمالة خارجية|عمل خارجي/i.test(`${row.expense_type || ""} ${row.category_name || ""} ${row.description || ""}`)).reduce((sum, row) => sum + expenseNet(row), 0);
  const totalBilled = cashBilled + insuranceBilled;
  const totalCollected = cashCollected + insuranceCollected;
  const actualProfit = billedBeforeVat - directCostBeforeVat;
  return {
    cashBilled: roundMoney(cashBilled), insuranceBilled: roundMoney(insuranceBilled), totalBilled: roundMoney(totalBilled),
    cashCollected: roundMoney(cashCollected), insuranceCollected: roundMoney(insuranceCollected), totalCollected: roundMoney(totalCollected),
    expenses: roundMoney(expenses), partsExpenses: roundMoney(partsExpenses), otherExpenses: roundMoney(expenses - partsExpenses),
    invoiceMargin: roundMoney(totalBilled - expenses), cashflowMargin: roundMoney(totalCollected - expenses),
    outstanding: roundMoney(Math.max(0, totalBilled - totalCollected)),
    billedBeforeVat: roundMoney(billedBeforeVat), vatTotal: roundMoney(vatTotal), directCostBeforeVat: roundMoney(directCostBeforeVat),
    externalLabor: roundMoney(externalLabor), actualProfit: roundMoney(actualProfit),
    profitMarginPct: billedBeforeVat > 0 ? Math.round((actualProfit / billedBeforeVat) * 10_000) / 100 : 0,
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

export async function fetchVehicle360Snapshot(tenantId: string, vehicleId: string, plate: string, options: { includeFinancial?: boolean } = {}): Promise<Vehicle360Snapshot> {
  if (!tenantId || !vehicleId) throw new Error("vehicle_360_identity_required");
  const includeFinancial = options.includeFinancial !== false;
  const [workOrders, claims, entries, handovers, directExpenses, trackingCount, trackingLatest] = await Promise.all([
    rows((supabase.from("job_orders") as any).select("id,order_number,status,work_order_type,service_type,entry_date,received_at,created_at,updated_at,work_started_at,work_completed_at,completed_at,vehicle_delivered_at,vehicle_presence_status,technician_name,diagnosis,description,labor_cost,parts_cost,final_total,claim_id,insurance_claim_number,insurance_company,archived_at,deleted_at,visit_number,vehicle_entry_id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false })),
    rows((supabase.from("insurance_claims") as any).select("id,claim_number,status,insurance_company,insurance_company_id,created_at,updated_at,vehicle_received_at,workshop_arrival_date,insurance_approved_at,approved_at,approved_amount,lpo_amount,lpo_number,work_started_at,repair_started_at,work_completed_at,vehicle_delivered_at,delivered_at,vehicle_presence_status,repair_stage,job_order_id,auto_job_order_id,deleted_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false })),
    rows((supabase.from("vehicle_entries") as any).select("id,entry_number,status,arrival_date,arrival_time,arrival_method,vehicle_location,vehicle_location_bay,received_by_name,insurance_claim_id,work_order_id,converted_claim_id,converted_work_order_id,created_at,updated_at,deleted_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("arrival_date", { ascending: false })),
    rows((supabase.from("vehicle_handover_records" as any) as any).select("id,receipt_number,status,work_order_id,claim_id,vehicle_id,delivered_at,finalized_at,cancelled_at,cancellation_reason,recipient_type,recipient_name,created_at,updated_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }), "vehicle_handover_records"),
    includeFinancial ? rows((supabase.from("expenses") as any).select(EXPENSE_SELECTION).eq("tenant_id", tenantId).eq("vehicle_id", vehicleId)) : Promise.resolve([]),
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
  if (includeFinancial && plate) expensePromises.push(rows((supabase.from("expenses") as any).select(EXPENSE_SELECTION).eq("tenant_id", tenantId).eq("linked_vehicle_plate", plate)));
  if (includeFinancial && orderRefs.length) {
    expensePromises.push(rows((supabase.from("expenses") as any).select(EXPENSE_SELECTION).eq("tenant_id", tenantId).in("linked_work_order_id", orderRefs)));
    expensePromises.push(rows((supabase.from("expenses") as any).select(EXPENSE_SELECTION).eq("tenant_id", tenantId).in("work_order_id", orderRefs)));
  }
  if (includeFinancial && claimIds.length) expensePromises.push(rows((supabase.from("expenses") as any).select(EXPENSE_SELECTION).eq("tenant_id", tenantId).in("claim_id", claimIds)));

  const [expenseGroups, parts, cashByWorkOrder, cashByPlate, insuranceInvoices] = await Promise.all([
    Promise.all(expensePromises),
    includeFinancial && orderIds.length ? rows((supabase.from("job_order_parts") as any).select("id,job_order_id,quantity,unit_price,total_price,created_at,inventory:inventory_id(name,part_number)").eq("tenant_id", tenantId).in("job_order_id", orderIds)) : Promise.resolve([]),
    includeFinancial && orderRefs.length ? rows((supabase.from("sales_documents") as any).select("id,doc_number,status,invoice_status,date,issued_at,created_at,subtotal,tax_total,total,paid_amount,balance_due,work_order_id,vehicle_plate,deleted_at,archived_at").eq("tenant_id", tenantId).eq("doc_type", "invoice").in("work_order_id", orderRefs)) : Promise.resolve([]),
    includeFinancial && plate ? rows((supabase.from("sales_documents") as any).select("id,doc_number,status,invoice_status,date,issued_at,created_at,subtotal,tax_total,total,paid_amount,balance_due,work_order_id,vehicle_plate,deleted_at,archived_at").eq("tenant_id", tenantId).eq("doc_type", "invoice").eq("vehicle_plate", plate)) : Promise.resolve([]),
    includeFinancial && claimIds.length ? rows((supabase.from("insurance_invoices" as any) as any).select("id,claim_id,invoice_number,status,invoice_date,issued_at,created_at,subtotal,vat,total,paid_amount,last_payment_date,insurance_company_name,vehicle_plate").eq("tenant_id", tenantId).in("claim_id", claimIds)) : Promise.resolve([]),
  ]);

  const expenses = uniqueRows([directExpenses, ...expenseGroups].flat());
  const cashInvoices = uniqueRows([...cashByWorkOrder, ...cashByPlate]);
  const cashInvoiceIds = uniqueStrings(cashInvoices.map((row) => row.id));
  const [cashPayments, insurancePayments] = await Promise.all([
    includeFinancial && cashInvoiceIds.length ? rows((supabase.from("sales_payments") as any).select("id,sales_document_id,payment_number,date,created_at,amount,method,reference").eq("tenant_id", tenantId).in("sales_document_id", cashInvoiceIds)) : Promise.resolve([]),
    includeFinancial && claimIds.length ? rows((supabase.from("claim_payments") as any).select("id,claim_id,payment_number,payment_date,created_at,amount,payment_method,reference_number,status").eq("tenant_id", tenantId).in("claim_id", claimIds)) : Promise.resolve([]),
  ]);

  const base = { vehicleId, workOrders, claims, entries, handovers, expenses, parts, cashInvoices, insuranceInvoices, cashPayments, insurancePayments, media: [], auditLogs: [], estimates: [], signatures: [], communications: [], tracking: { count: Number(trackingCount.count || 0), lastOpenedAt: trackingLatest.data?.opened_at || null } };
  const timeline = buildVehicleTimeline(base);
  const financial = calculateVehicleFinancials(base);
  const closed = new Set(["delivered", "closed", "completed", "cancelled", "canceled", "rejected"]);
  const activeWorkOrder = workOrders.find((row) => !row.deleted_at && !closed.has(String(row.status || "").toLowerCase())) || null;
  const activeClaim = claims.find((row) => !row.deleted_at && !closed.has(String(row.status || "").toLowerCase())) || null;
  const presence = activeWorkOrder?.vehicle_presence_status || activeClaim?.vehicle_presence_status || (handovers[0]?.status === "finalized" ? "delivered" : "with_customer");
  const visitDates = uniqueStrings([...entries.map((row) => row.arrival_date), ...workOrders.map((row) => row.entry_date || row.received_at), ...claims.map((row) => row.vehicle_received_at || row.workshop_arrival_date)]).sort();
  return { ...base, timeline, financial, activeWorkOrder, activeClaim, currentPresence: presence, firstVisitAt: visitDates[0] || null, lastVisitAt: visitDates.at(-1) || null };
}

export async function fetchVehicle360Media(tenantId: string, vehicleId: string, workOrderIds: string[], claimIds: string[]) {
  const selection = "id,media_type,category,caption,description,file_name,file_size,mime_type,public_url,storage_bucket,storage_path,stage,source,vehicle_id,work_order_id,claim_id,vehicle_entry_id,uploaded_at,uploaded_by,created_at,deleted_at";
  const groups = await Promise.all([
    rows((supabase.from("vehicle_media") as any).select(selection).eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).is("deleted_at", null).order("uploaded_at", { ascending: false })),
    workOrderIds.length ? rows((supabase.from("vehicle_media") as any).select(selection).eq("tenant_id", tenantId).in("work_order_id", workOrderIds).is("deleted_at", null)) : Promise.resolve([]),
    claimIds.length ? rows((supabase.from("vehicle_media") as any).select(selection).eq("tenant_id", tenantId).in("claim_id", claimIds).is("deleted_at", null)) : Promise.resolve([]),
  ]);
  return uniqueRows(groups.flat());
}

export async function fetchVehicle360Estimates(tenantId: string, vehicleId: string, workOrderIds: string[], claimIds: string[]) {
  const estimateGroups = await Promise.all([
    rows((supabase.from("estimates") as any).select("id,estimate_number,estimate_type,status,estimate_date,issued_at,created_at,subtotal,vat_amount,total,claim_id,work_order_id,vehicle_id,insurance_company_id,purpose").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).is("archived_at", null).order("estimate_date", { ascending: false })),
    workOrderIds.length ? rows((supabase.from("estimates") as any).select("id,estimate_number,estimate_type,status,estimate_date,issued_at,created_at,subtotal,vat_amount,total,claim_id,work_order_id,vehicle_id,insurance_company_id,purpose").eq("tenant_id", tenantId).in("work_order_id", workOrderIds).is("archived_at", null)) : Promise.resolve([]),
    claimIds.length ? rows((supabase.from("insurance_estimates") as any).select("id,estimate_number,status,estimation_type,created_at,converted_at,converted_claim_id,lump_sum_amount,insurance_company,insurance_company_id,vehicle_plate,vehicle_make,vehicle_model,upl_items").eq("tenant_id", tenantId).in("converted_claim_id", claimIds)) : Promise.resolve([]),
  ]);
  return uniqueRows(estimateGroups.flat());
}

export async function fetchVehicle360Signatures(tenantId: string, entryIds: string[], handovers: Row[]) {
  const entrySignatures = entryIds.length
    ? await rows((supabase.from("vehicle_entry_signatures") as any).select("id,vehicle_entry_id,signature_role,signature_data_url,signer_name,signer_phone,signer_title,signed_at,signed_by,created_at").eq("tenant_id", tenantId).in("vehicle_entry_id", entryIds).order("created_at", { ascending: false }))
    : [];
  const handoverSignatures = handovers.filter((row) => row.signature_data_url).map((row) => ({ ...row, signature_role: "delivery", signer_name: row.recipient_name, signed_at: row.finalized_at || row.delivered_at }));
  return uniqueRows([...entrySignatures, ...handoverSignatures]);
}

export async function fetchVehicle360Communications(tenantId: string, vehicleId: string, workOrderIds: string[], claimIds: string[]) {
  const messageSelection = "id,channel,direction,status,body,message,message_type,recipient_phone,recipient_email,sent_at,created_at,created_by,user_id,vehicle_id,work_order_id,claim_id,metadata";
  const groups: Promise<Row[]>[] = [rows((supabase.from("message_logs") as any).select(messageSelection).eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(250))];
  if (workOrderIds.length) {
    groups.push(rows((supabase.from("message_logs") as any).select(messageSelection).eq("tenant_id", tenantId).in("work_order_id", workOrderIds).limit(250)));
    groups.push(rows((supabase.from("customer_notifications") as any).select("id,channel,status,subject,body,event_type,recipient,sent_at,created_at,created_by,job_order_id,payload").eq("tenant_id", tenantId).in("job_order_id", workOrderIds).limit(250)));
  }
  if (claimIds.length) groups.push(rows((supabase.from("message_logs") as any).select(messageSelection).eq("tenant_id", tenantId).in("claim_id", claimIds).limit(250)));
  return uniqueRows((await Promise.all(groups)).flat()).sort((a, b) => String(b.sent_at || b.created_at).localeCompare(String(a.sent_at || a.created_at)));
}

export async function fetchVehicle360Audit(tenantId: string, vehicleId: string, workOrderIds: string[], claimIds: string[], entryIds: string[]) {
  const groups: Promise<Row[]>[] = [
    rows((supabase.from("operational_audit_log") as any).select("id,action,entity_type,entity_id,reason,user_id,created_at,before_snapshot,after_snapshot,related_entities").eq("tenant_id", tenantId).eq("entity_type", "vehicle").eq("entity_id", vehicleId).order("created_at", { ascending: false }).limit(250)),
    rows((supabase.from("claim_audit_logs") as any).select("id,claim_id,vehicle_id,action,category,details,user_id,created_at").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(250)),
  ];
  if (workOrderIds.length) groups.push(rows((supabase.from("job_order_logs") as any).select("id,job_order_id,action,details,user_id,created_at").eq("tenant_id", tenantId).in("job_order_id", workOrderIds).limit(250)));
  if (entryIds.length) groups.push(rows((supabase.from("vehicle_entry_audit_logs") as any).select("id,vehicle_entry_id,action,reason,user_id,created_at,old_value,new_value").eq("tenant_id", tenantId).in("vehicle_entry_id", entryIds).limit(250)));
  if (claimIds.length) groups.push(rows((supabase.from("claim_audit_logs") as any).select("id,claim_id,vehicle_id,action,category,details,user_id,created_at").eq("tenant_id", tenantId).in("claim_id", claimIds).limit(250)));
  return uniqueRows((await Promise.all(groups)).flat()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function composeVehicle360Snapshot(base: Vehicle360Snapshot, sections: Partial<Pick<Vehicle360Snapshot, "media" | "auditLogs" | "estimates" | "signatures" | "communications">>): Vehicle360Snapshot {
  const next = { ...base, ...sections };
  return { ...next, timeline: buildVehicleTimeline(next), financial: calculateVehicleFinancials(next) };
}
