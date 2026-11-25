import { claimEmailControlled, claimEmailSourceText, type ClaimEmailSummaryField, type ClaimEmailTemplateId } from "./claimEngineerEmailTemplates.ts";
type Row = Record<string, any>;
export type ClaimEmailAttachmentKind = "source_document" | "vehicle_photo" | "repair_estimate" | "quote" | "invoice" | "work_order" | "signed_intake" | "technical_declaration";
export interface ClaimEmailGeneratedDocument {
  id: string; kind: ClaimEmailAttachmentKind; sourceKind: string; sourceId: string; sourceHash: string;
  fileName: string; mimeType: "application/pdf"; renderer: "vehicle_entry" | "technical_declaration" | "work_order" | "estimate" | "quote" | "insurance_invoice" | "claim_estimate";
  data: Row; defaultSelected: boolean;
}
const MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const safeFile = (value: unknown) => String(value || "Document").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 150);
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object" && !Array.isArray(row)) : [];
async function many(query: any): Promise<Row[]> {
  const result = await query.limit(MAX + 1);
  if (result.error || !Array.isArray(result.data)) fail("claim_email_document_unavailable");
  if (result.data.length > MAX || (typeof result.count === "number" && result.count > result.data.length)) fail("claim_email_source_limit_exceeded");
  return result.data;
}
function cleanRows(rows: Row[], tenantId: string) {
  for (const row of rows) if (row.tenant_id !== tenantId || !UUID.test(row.id || "")) fail("claim_email_document_unavailable");
  return rows;
}
export function claimEmailMediaKind(category: string): ClaimEmailAttachmentKind | null {
  return ({ claim_estimate: "repair_estimate", quote: "quote", quotation: "quote", estimate: "quote", tax_invoice: "invoice", insurance_invoice: "invoice", work_order: "work_order", job_order: "work_order", vehicle_entry: "signed_intake", signed_intake: "signed_intake", technical_declaration: "technical_declaration" } as Record<string, ClaimEmailAttachmentKind>)[category] || null;
}
export const claimEmailPriority = (kind: ClaimEmailAttachmentKind) => ["vehicle_photo", "source_document", "signed_intake", "repair_estimate"].includes(kind);

export async function expandClaimEmailDocuments(input: {
  caller: any; admin: any; tenantId: string; claim: Row; entry: Row; vehicle: Row; mediaRows: Row[]; canonicalVisit: boolean;
  signedEntry: Row | null; frozenReceiptId: string | null; technical: Row | null; templateId: ClaimEmailTemplateId; defaultTechnical: boolean;
  language: "ar" | "en"; hash: (value: unknown) => Promise<string>; storedAttachment: (row: Row) => any;
}) {
  const { caller, admin, tenantId, claim, entry, vehicle, canonicalVisit, language } = input;
  const [allOrders, allEstimates, invoices] = await Promise.all([
    many(caller.from("job_orders").select("*", { count: "exact" }).eq("tenant_id", tenantId).eq("claim_id", claim.id).is("deleted_at", null)),
    many(caller.from("estimates").select("*", { count: "exact" }).eq("tenant_id", tenantId).eq("claim_id", claim.id).is("archived_at", null)),
    canonicalVisit ? many(caller.from("insurance_invoices").select("*", { count: "exact" }).eq("tenant_id", tenantId).eq("claim_id", claim.id)) : Promise.resolve([]),
  ]);
  cleanRows(allOrders, tenantId); cleanRows(allEstimates, tenantId); cleanRows(invoices, tenantId);
  const orderPointers = new Set([entry.work_order_id, entry.converted_work_order_id].filter(Boolean));
  const orders = allOrders.filter(order => order.vehicle_id === claim.vehicle_id && order.claim_id === claim.id && order.work_order_type === "insurance"
    && (order.vehicle_entry_id === entry.id || orderPointers.has(order.id) || (canonicalVisit && !order.vehicle_entry_id))).sort((a, b) => a.id.localeCompare(b.id));
  const orderIds = orders.map(order => order.id);
  const estimates = allEstimates.filter(estimate => (!estimate.vehicle_id || estimate.vehicle_id === claim.vehicle_id)
    && (!estimate.insurance_company_id || estimate.insurance_company_id === claim.insurance_company_id)
    && (!estimate.work_order_id ? canonicalVisit : orderIds.includes(estimate.work_order_id))
    && !["cancelled", "archived"].includes(estimate.status)).sort((a, b) => a.id.localeCompare(b.id));
  const validInvoices = invoices.filter(invoice => invoice.claim_id === claim.id
    && (invoice.insurance_company_id ? invoice.insurance_company_id === claim.insurance_company_id : !!claim.insurance_company && invoice.insurance_company_name === claim.insurance_company)
    && !["cancelled", "credited"].includes(invoice.status)).sort((a, b) => a.id.localeCompare(b.id));
  const [quoteRows, estimateItems, inspectionRows] = await Promise.all([
    orderIds.length ? many(caller.from("sales_documents").select("*", { count: "exact" }).eq("tenant_id", tenantId).eq("doc_type", "quote").in("work_order_id", orderIds).is("deleted_at", null).is("archived_at", null)) : Promise.resolve([]),
    estimates.length ? many(caller.from("estimate_items").select("*", { count: "exact" }).eq("tenant_id", tenantId).in("estimate_id", estimates.map(estimate => estimate.id))) : Promise.resolve([]),
    UUID.test(claim.inspection_id || "") ? many(caller.from("inspections").select("id,tenant_id,inspection_code,inspection_date,inspection_kind,job_order_id,notes,status,updated_at,entry_link:details->>vehicleEntryId,claim_link:details->>claimId,report_number:details->insuranceInspectionReport->>reportNo,report_remarks:details->insuranceInspectionReport->>remarks,report_sections:details->insuranceInspectionReport->sections", { count: "exact" }).eq("tenant_id", tenantId).eq("id", claim.inspection_id).eq("inspection_kind", "insurance")) : Promise.resolve([]),
  ]);
  cleanRows(quoteRows, tenantId); cleanRows(estimateItems, tenantId); cleanRows(inspectionRows, tenantId); estimateItems.sort((a, b) => a.id.localeCompare(b.id));
  const quotes = quoteRows.filter(row => row.doc_type === "quote" && orderIds.includes(row.work_order_id) && !["cancelled", "archived"].includes(row.status)).sort((a, b) => a.id.localeCompare(b.id));
  const inspection = inspectionRows.find(row => {
    const details = record(row.details);
    const entryLink = row.entry_link ?? details.vehicleEntryId, claimLink = row.claim_link ?? details.claimId;
    if (entryLink || claimLink) return entryLink === entry.id && claimLink === claim.id;
    return canonicalVisit && row.job_order_id && orderIds.includes(row.job_order_id);
  });
  const fixtureReport = record(record(inspection?.details).insuranceInspectionReport);
  const inspectionReport = { reportNo: inspection?.report_number ?? fixtureReport.reportNo, remarks: inspection?.report_remarks ?? fixtureReport.remarks, sections: inspection?.report_sections ?? fixtureReport.sections };
  const generated: ClaimEmailGeneratedDocument[] = [], stored: any[] = [], warnings: string[] = [];
  const sourceRows = { orders, estimates, invoices: validInvoices, quotes, estimateItems, inspection: inspection ? { id: inspection.id, updated_at: inspection.updated_at, status: inspection.status, report: inspectionReport } : null };
  async function descriptor(id: string, kind: ClaimEmailAttachmentKind, sourceKind: string, source: Row, renderer: ClaimEmailGeneratedDocument["renderer"], data: Row, name: string, checked = claimEmailPriority(kind)) {
    if (new TextEncoder().encode(JSON.stringify(data)).length > 8 * 1024 * 1024) fail("claim_email_document_source_too_large");
    generated.push({ id, kind, sourceKind, sourceId: source.id, sourceHash: await input.hash({ source, data, language, entryId: entry.id }), renderer, data, fileName: safeFile(name) + ".pdf", mimeType: "application/pdf", defaultSelected: checked });
  }
  // Never synthesize a signature by merging current live fields with old ink.
  if (input.signedEntry && input.frozenReceiptId) await descriptor("entry:" + input.frozenReceiptId, "signed_intake", "intake_receipt", { id: input.frozenReceiptId, intake_revision: entry.intake_revision, frozenEntry: input.signedEntry }, "vehicle_entry", { entry: input.signedEntry, entryNumber: entry.entry_number }, "Signed-Vehicle-Entry-" + entry.entry_number, true);
  if (input.technical) generated.push({ id: "technical:" + input.technical.id, kind: "technical_declaration", sourceKind: "technical_declaration", sourceId: input.technical.id, sourceHash: input.technical.sourceHash, renderer: "technical_declaration", data: { formData: input.technical.formData, entryNumber: entry.entry_number }, fileName: input.technical.fileName, mimeType: "application/pdf", defaultSelected: input.defaultTechnical });

  // Only PDFs explicitly indexed to this claim/visit are eligible archives.
  // Cash/expense categories and any other visit's media are never adopted.
  const pdfMedia = input.mediaRows.filter(row => row.tenant_id === tenantId && !row.deleted_at && row.media_type === "document"
    && row.mime_type === "application/pdf" && row.claim_id === claim.id && (!row.vehicle_id || row.vehicle_id === claim.vehicle_id)
    && (row.vehicle_entry_id ? row.vehicle_entry_id === entry.id : canonicalVisit)
    && row.storage_bucket !== "expense-documents" && !!claimEmailMediaKind(row.category)
    && !["invoice", "cash_invoice", "expense", "supplier_invoice", "purchase_invoice", "expense_receipt"].includes(row.category)
    && (!["tax_invoice", "insurance_invoice"].includes(row.category) || validInvoices.length === 1)
    && (!["work_order", "job_order"].includes(row.category) || orderIds.includes(row.work_order_id))
    && !["vehicle_entry", "signed_intake", "technical_declaration"].includes(row.category)).sort((a, b) => a.id.localeCompare(b.id));
  const newestEstimate = pdfMedia.filter(row => row.category === "claim_estimate")
    .sort((a, b) => String(b.uploaded_at || b.created_at || "").localeCompare(String(a.uploaded_at || a.created_at || "")))[0];
  for (const row of pdfMedia) {
    if (row.category === "claim_estimate" && row.id !== newestEstimate?.id) continue;
    if (row.category === "claim_estimate" && (claim.claim_estimate_document_status === "modified_after_send"
      || (claim.claim_estimate_modified_at && String(claim.claim_estimate_modified_at) > String(row.uploaded_at || row.created_at || ""))
      || (claim.claim_estimate_storage_path && claim.claim_estimate_storage_path !== row.storage_path))) continue;
    if (["tax_invoice", "insurance_invoice"].includes(row.category)) {
      // A historical archive is not substituted for a different issued invoice.
      // If no authoritative PDF pointer binds this object, use the exact saved
      // insurance-invoice row below instead of guessing from a generic filename.
      let boundPath = "";
      try {
        const pointer = new URL(validInvoices[0]?.pdf_url || "");
        const match = /^\/storage\/v1\/object\/(?:sign|public|authenticated)\/insurance-docs\/(.+)$/.exec(pointer.pathname);
        if (pointer.protocol === "https:" && match) boundPath = decodeURIComponent(match[1]);
      } catch { /* No saved pointer: canonical row remains available. */ }
      if (row.storage_bucket !== "insurance-docs" || boundPath !== row.storage_path) continue;
    }
    const candidate = { ...row };
    // Validate tenant prefix, bucket, MIME, filename and ownership before any
    // privileged metadata/download read, including historical rows without size.
    input.storedAttachment({ ...candidate, file_size: Number(candidate.file_size) > 0 ? candidate.file_size : 1 });
    let checksum: string | undefined;
    if (!Number.isSafeInteger(Number(candidate.file_size)) || Number(candidate.file_size) < 1) {
      // Older saveClaimDocument rows omitted file_size. Read trusted Storage
      // metadata where supported, otherwise verify the original bytes once.
      const object = caller.storage?.from(candidate.storage_bucket);
      if (!object) fail("claim_email_attachment_metadata_required");
      if (typeof object.info === "function") {
        const result = await object.info(candidate.storage_path);
        if (result.error) fail("claim_email_attachment_unavailable");
        candidate.file_size = result.data?.size ?? result.data?.metadata?.size;
      } else {
        const result = await object.download(candidate.storage_path);
        if (result.error || !result.data || result.data.size < 1 || result.data.size > 12 * 1024 * 1024) fail("claim_email_attachment_unavailable");
        candidate.file_size = result.data.size;
        const bytes = new Uint8Array(await result.data.arrayBuffer());
        if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") fail("claim_email_attachment_changed");
        const owned = new Uint8Array(bytes.byteLength); owned.set(bytes);
        const digest = await crypto.subtle.digest("SHA-256", owned.buffer); checksum = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
      }
    }
    const attachment = input.storedAttachment(candidate);
    stored.push({ ...attachment, kind: claimEmailMediaKind(row.category), defaultSelected: claimEmailPriority(claimEmailMediaKind(row.category)!), ...(checksum ? { sha256: checksum } : {}), category: row.category, sourceUpdatedAt: row.uploaded_at || row.created_at || null });
  }
  const storedKind = (kind: string) => stored.some(file => file.kind === kind);
  const customer = record(entry.customer_snapshot), snapshot = record(entry.vehicle_snapshot);
  const vehicleInfo = { id: vehicle.id, brand: vehicle.brand, model: vehicle.model, year: vehicle.year || snapshot.year, plate_number: vehicle.plate_number, vin_number: vehicle.vin_number || vehicle.vin || snapshot.vin };
  const customerInfo = { id: claim.customer_id, name: customer.name || "", phone: customer.phone || "" };
  for (const order of orders) {
    if (stored.some(file => file.kind === "work_order" && input.mediaRows.find(row => row.id === file.sourceId)?.work_order_id === order.id)) continue;
    const data = { orderNumber: order.order_number, workOrderType: "insurance", date: order.entry_date || order.received_at || order.created_at, customerName: customerInfo.name, customerPhone: customerInfo.phone, vehicleType: vehicle.brand || "", model: vehicle.model || "", year: String(vehicleInfo.year || ""), plateNumber: `${vehicle.plate_number}/${vehicle.plate_letters}`, vin: vehicleInfo.vin_number || "", insurance: claim.insurance_company || "", claimNumber: claim.claim_number, serviceType: claimEmailSourceText(order.service_type, language, ""), technician: claimEmailSourceText(order.technician_name, language, ""), status: order.status, totalCost: Number(order.final_total ?? order.subtotal ?? 0), description: claimEmailSourceText(order.description || order.diagnosis_notes || order.diagnosis, language, ""), workItems: array(order.work_items).map(item => ({ title: claimEmailSourceText(item.title || item.name || item.description, language, ""), note: claimEmailSourceText(item.note || item.notes, language, "") })) };
    await descriptor("work-order:" + order.id, "work_order", "job_order", order, "work_order", data, "Work-Order-" + order.order_number, false);
  }
  const claimEstimateExists = !!(claim.claim_estimate_number || Number(claim.claim_estimate_revision) > 0 || claim.claim_estimate_generated_at);
  const latestInsuranceEstimate = estimates.filter(estimate => estimate.estimate_type === "insurance").sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")) || a.id.localeCompare(b.id))[0];
  for (const estimate of estimates) {
    const items = estimateItems.filter(item => item.estimate_id === estimate.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id.localeCompare(b.id));
    const data = { ...estimate, internal_notes: undefined, customer: customerInfo, vehicle: vehicleInfo, claim: { id: claim.id, claim_number: claim.claim_number, insurance_company: claim.insurance_company }, items };
    const kind = estimate.estimate_type === "insurance" ? "repair_estimate" : "quote";
    await descriptor("estimate:" + estimate.id, kind, "estimate", { ...estimate, items }, "estimate", data, "Estimate-" + estimate.estimate_number, kind === "repair_estimate" && !storedKind("repair_estimate") && !claimEstimateExists && latestInsuranceEstimate?.id === estimate.id);
  }
  for (const quote of quotes) {
    const data = { invoiceNumber: quote.doc_number, quoteNumber: quote.doc_number, date: quote.date, customerName: quote.customer_name || customerInfo.name, customerPhone: quote.customer_phone || customerInfo.phone, vehicleInfo: [vehicle.brand, vehicle.model].filter(Boolean).join(" "), plateNumber: `${vehicle.plate_number}/${vehicle.plate_letters}`, items: array(quote.items).map(item => { const quantity = Number(item.quantity) || 0, unitPrice = Number(item.unitPrice ?? item.unit_price) || 0; return { description: claimEmailSourceText(item.description || item.itemName, language, ""), quantity, unitPrice, total: Number(item.total ?? item.line_total ?? quantity * unitPrice) }; }), subtotal: quote.subtotal, vat: quote.tax_total, total: quote.total, notes: claimEmailSourceText(quote.notes, language, "") };
    await descriptor("quote:" + quote.id, "quote", "sales_quote", quote, "quote", data, "Quote-" + quote.doc_number, false);
  }
  for (const invoice of validInvoices) {
    if (validInvoices.length === 1 && storedKind("invoice")) continue;
    const data = { docType: "invoice", template: "default", number: invoice.invoice_number, invoiceNumber: invoice.invoice_number, issueDate: invoice.invoice_date || invoice.issued_at, paymentDueDate: invoice.due_date || undefined, customerName: invoice.insurance_company_name, insuranceCompany: invoice.insurance_company_name, claimNumber: claim.claim_number, vehiclePlate: `${vehicle.plate_number}/${vehicle.plate_letters}`, vehicleInfo: [vehicle.brand, vehicle.model].filter(Boolean).join(" "), lpoNumber: invoice.lpo_number || undefined, customFields: [], items: array(invoice.items).map(item => ({ description: claimEmailSourceText(item.description, language, ""), quantity: Number(item.quantity) || 0, unitPrice: Number(item.unit_price ?? item.unitPrice) || 0, discount: Number(item.discount) || 0, tax: Number(item.tax) || 0 })), subtotal: Number(invoice.subtotal), discountTotal: 0, taxTotal: Number(invoice.vat), total: Number(invoice.total), notes: claimEmailSourceText(invoice.notes, language, "") };
    await descriptor("invoice:" + invoice.id, "invoice", "insurance_invoice", invoice, "insurance_invoice", data, "Insurance-Invoice-" + invoice.invoice_number, false);
  }
  // A saved estimate source is enough to render it; never create/approve one.
  if (!storedKind("repair_estimate") && canonicalVisit && claimEstimateExists) {
    const data = { estimateNumber: claim.claim_estimate_number || null, claimNumber: claim.claim_number, date: claim.estimate_date || claim.claim_estimate_generated_at || claim.created_at, insuranceCompany: claim.insurance_company || "", policyNumber: claim.policy_number || null, customerName: customerInfo.name, customerPhone: customerInfo.phone, vehicle: { make: vehicle.brand, model: vehicle.model, plate: `${vehicle.plate_number}/${vehicle.plate_letters}`, year: vehicleInfo.year, vin: vehicleInfo.vin_number }, estimationType: claim.estimation_type === "upl" ? "upl" : "lump_sum", lumpSumAmount: Number(claim.estimated_cost ?? claim.estimated_amount ?? 0), uplItems: array(claim.upl_items).map(item => ({ description: claimEmailSourceText(item.description, language, ""), quantity: Number(item.quantity) || 0, unit_price: Number(item.unit_price) || 0 })), approvedAmount: claim.approved_amount, deductibleAmount: Number(claim.deductible_amount) || 0, notes: claimEmailSourceText(claim.notes, language, ""), damagePhotos: [] };
    await descriptor("claim-estimate:" + claim.id, "repair_estimate", "insurance_claim_estimate", { id: claim.id, revision: claim.claim_estimate_revision, content_hash: claim.claim_estimate_content_hash, data }, "claim_estimate", data, "Repair-Estimate-" + (claim.claim_estimate_number || claim.claim_number), true);
  }
  const statusSummary: ClaimEmailSummaryField[] = [];
  const field = (key: string, ar: string, en: string, value: string, source: string) => statusSummary.push({ key, label: language === "en" ? en : ar, value: value.slice(0, 1800), source });
  const claimStatuses: Record<string, [string, string]> = { pending: ["بانتظار الاعتماد", "Pending approval"], approved: ["معتمدة", "Approved"], rejected: ["مرفوضة", "Rejected"], paid: ["مسددة", "Paid"], cancelled: ["ملغاة", "Cancelled"] };
  const stageLabels: Record<string, [string, string]> = { received: ["استلام", "Received"], inspection: ["فحص", "Inspection"], waiting_parts: ["بانتظار القطع", "Waiting for parts"], in_progress: ["قيد الإصلاح", "Repair in progress"], bodywork: ["سمكرة", "Bodywork"], painting: ["صبغ", "Painting"], quality: ["فحص الجودة", "Quality check"], completed: ["مكتملة", "Completed"], delivered: ["مسلمة", "Delivered"] };
  const condition = record(entry.vehicle_condition);
  field("claim_status", "حالة المطالبة", "Claim status", claimEmailControlled(claim.status, language, claimStatuses), "insurance_claim");
  const currentOrder = orders.find(order => order.id === entry.work_order_id) || orders.find(order => order.id === entry.converted_work_order_id) || orders.find(order => order.vehicle_entry_id === entry.id) || orders[0];
  field("repair_stage", "مرحلة الإصلاح", "Repair stage", claimEmailControlled(claim.repair_stage || currentOrder?.status, language, stageLabels), claim.repair_stage ? "insurance_claim" : currentOrder ? "job_order" : "unknown");
  field("vehicle_location", "موقع المركبة المسجل", "Recorded vehicle location", claimEmailControlled(entry.vehicle_location, language, { "داخل الورشة": ["داخل الورشة", "In workshop"], "مع العميل": ["مع العميل", "With customer"], in_workshop: ["داخل الورشة", "In workshop"], with_customer: ["مع العميل", "With customer"] }), "vehicle_entry");
  field("running_status", "حالة تشغيل المركبة", "Vehicle running condition", claimEmailControlled(condition.running_status, language, { running: ["تعمل", "Vehicle runs"], not_running: ["لا تعمل", "Vehicle does not run"], unknown: ["غير مسجل / لم يتم الفحص", "Not recorded / not checked"] }), "vehicle_entry");
  field("arrival_date", "تاريخ الدخول", "Arrival date", claimEmailSourceText(entry.arrival_date, language), "vehicle_entry");
  field("inspection_reference", "مرجع الفحص", "Inspection reference", claimEmailSourceText(inspection?.inspection_code || inspectionReport.reportNo, language), inspection ? "inspection" : "unknown");
  const findings = array(inspectionReport.sections).flatMap(section => array(section.items)).filter(item => item.repair || item.suspect || item.replace).slice(0, 20).map(item => {
    const actions = [item.repair ? (language === "en" ? "Repair" : "إصلاح") : "", item.suspect ? (language === "en" ? "Suspect" : "اشتباه") : "", item.replace ? (language === "en" ? "Replace" : "استبدال") : ""].filter(Boolean).join(" / ");
    return `${claimEmailSourceText(language === "en" ? item.en : item.ar || item.en, language)}: ${actions}${item.comment ? " - " + claimEmailSourceText(item.comment, language) : ""}`;
  }).join("; ");
  field("inspection_findings", "نتائج الفحص المسجلة", "Recorded inspection findings", findings || claimEmailSourceText(inspectionReport.remarks || inspection?.notes, language, language === "en" ? "No findings recorded for this visit" : "لم تسجل نتائج فحص لهذه الزيارة"), inspection ? "inspection" : "unknown");
  const conditionNotes = [...new Set([condition.condition_description, condition.visible_damage, condition.previous_damage, condition.mechanical_notes, condition.electrical_notes, condition.additional_notes, condition.new_damage_notes]
    .filter(value => typeof value === "string" && value.trim()).map(value => claimEmailSourceText(value, language)))].join("; ");
  field("condition_notes", "ملاحظات حالة المركبة", "Saved vehicle condition notes", conditionNotes || claimEmailSourceText(null, language), "vehicle_entry");
  if (claim.notes) field("claim_notes", "ملاحظات المطالبة", "Saved claim notes", claimEmailSourceText(claim.notes, language), "insurance_claim");
  return { stored, generatedDocuments: generated, statusSummary, sourceRows, warnings };
}
