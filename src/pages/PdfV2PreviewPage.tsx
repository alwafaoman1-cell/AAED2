import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPdfV2Html, createPdfV2Blob, downloadPdfV2, openPdfV2Viewer, type PdfV2DocumentType } from "@/lib/pdf-v2";
import { supabase } from "@/integrations/supabase/client";
import {
  buildTrackingQrDataUrl,
  getInsuranceTaxInvoiceHtml,
  getInvoiceHtml,
  getVehicleDeliveryReceiptHtml,
  getWorkOrderHtml,
} from "@/lib/pdfGenerator";
import { buildZatcaQrDataUrl } from "@/lib/zatcaQr";
import { formatCurrencyEnglish, formatDateEnglish, formatDateTimeEnglish, toEnglishDigits } from "@/lib/formatters/numberFormat";

type LoadedPdf = { html: string; meta: { documentType: PdfV2DocumentType; documentNumber?: string; title?: string; language?: "ar" | "en"; layout?: "a4-portrait" | "a4-landscape" | "qr-label" } };

function e(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function simpleCard(title: string, rows: Array<[string, unknown]>) {
  return `
    <section class="pdf-v2-card">
      <h2>${e(title)}</h2>
      <table class="pdf-v2-table">
        <tbody>${rows.map(([k, v]) => `<tr><th>${e(k)}</th><td>${e(toEnglishDigits(v ?? "—"))}</td></tr>`).join("")}</tbody>
      </table>
    </section>
  `;
}

async function fetchOne(table: string, id: string) {
  const byId = await (supabase.from(table as any) as any).select("*").eq("id", id).maybeSingle();
  if (byId.data || byId.error) return byId;
  return { data: null, error: null };
}

async function loadWorkOrderBundle(id: string) {
  let res = await (supabase.from("job_orders" as any) as any).select("*").eq("id", id).maybeSingle();
  if (!res.data) res = await (supabase.from("job_orders" as any) as any).select("*").eq("order_number", id).maybeSingle();
  const jo = res.data;
  if (!jo) throw new Error(res.error?.message || "Work order not found");
  const [{ data: cust }, { data: veh }, { data: tok }] = await Promise.all([
    jo.customer_id ? supabase.from("customers" as any).select("*").eq("id", jo.customer_id).maybeSingle() : Promise.resolve({ data: null } as any),
    jo.vehicle_id ? supabase.from("vehicles" as any).select("*").eq("id", jo.vehicle_id).maybeSingle() : Promise.resolve({ data: null } as any),
    supabase.from("customer_portal_tokens" as any).select("token,signature_data_url,signer_name,signed_at").eq("job_order_id", jo.id).maybeSingle(),
  ]);
  return { jo, cust, veh, tok };
}

async function loadSalesInvoice(id: string): Promise<LoadedPdf> {
  const { data: doc, error } = await fetchOne("sales_documents", id);
  if (error || !doc) throw new Error(error?.message || "Cash invoice not found");
  const { data: payments } = await (supabase.from("sales_payments" as any) as any)
    .select("id,date,amount,method,reference")
    .eq("sales_document_id", doc.id)
    .order("date", { ascending: false });
  const tpl = await import("@/lib/pdfGenerator").then((m) => m.getTemplateSettings());
  let qrDataUrl = "";
  try {
    qrDataUrl = await buildZatcaQrDataUrl({
      sellerName: tpl.companyName,
      vatNumber: tpl.vatNumber,
      timestamp: new Date(doc.date || doc.created_at || Date.now()).toISOString(),
      total: Number(doc.total || 0),
      vat: Number(doc.tax_total || 0),
    });
  } catch {
    qrDataUrl = "";
  }
  let trackingQr = "";
  if (doc.work_order_id) {
    const { data: tok } = await supabase.from("customer_portal_tokens" as any).select("token").eq("job_order_id", doc.work_order_id).maybeSingle();
    if ((tok as any)?.token) trackingQr = await buildTrackingQrDataUrl((tok as any).token);
  }
  const items = Array.isArray(doc.items) ? doc.items : [];
  const paidVia = Array.isArray(payments) && payments.length
    ? Array.from(new Set(payments.map((p: any) => p.method).filter(Boolean))).join(" + ")
    : "";
  let html = getInvoiceHtml({
    invoiceNumber: doc.doc_number || doc.id,
    date: doc.date || doc.created_at,
    customerName: doc.customer_name || "—",
    customerPhone: "",
    vehicleInfo: [doc.vehicle_make, doc.vehicle_model].filter(Boolean).join(" ") || "—",
    plateNumber: doc.vehicle_plate || "—",
    items: items.length ? items.map((it: any) => ({
      description: it.description || it.itemName || it.name || "Item",
      quantity: Number(it.quantity || 1),
      unitPrice: Number(it.unitPrice ?? it.unit_price ?? it.price ?? 0),
      total: Number(it.total ?? (Number(it.quantity || 1) * Number(it.unitPrice ?? it.unit_price ?? it.price ?? 0))),
    })) : [{ description: "Service", quantity: 1, unitPrice: Number(doc.subtotal || 0), total: Number(doc.subtotal || 0) }],
    subtotal: Number(doc.subtotal || 0),
    vat: Number(doc.tax_total || 0),
    total: Number(doc.total || 0),
    paidTotal: Number(doc.paid_amount || 0),
    balanceDue: Number(doc.balance_due || 0),
    notes: doc.notes || undefined,
    paidVia,
  });
  const qr = trackingQr || qrDataUrl;
  if (qr) {
    html = html.replace("</div></body>", `<div style="margin-top:12px;text-align:center"><img src="${qr}" style="width:95px;height:95px"/><div style="font-size:9px;color:#64748b">QR</div></div></div></body>`);
  }
  return { html, meta: { documentType: "cash-invoice", documentNumber: doc.doc_number, title: `Cash Invoice ${doc.doc_number}` } };
}

async function loadReceipt(id: string): Promise<LoadedPdf> {
  const { data: receipt } = await fetchOne("accounting_receipts", id);
  if (receipt) {
    return {
      html: simpleCard("Receipt Voucher", [
        ["Receipt No.", receipt.receipt_number],
        ["Date", formatDateEnglish(receipt.receipt_date)],
        ["Payer", receipt.payer_name],
        ["Method", receipt.payment_method],
        ["Amount", formatCurrencyEnglish(receipt.amount, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, "OMR")],
        ["Notes", receipt.notes],
      ]),
      meta: { documentType: "receipt", documentNumber: receipt.receipt_number, title: `Receipt ${receipt.receipt_number}` },
    };
  }
  const paymentRes = await fetchOne("sales_payments", id);
  const p = paymentRes.data;
  if (!p) throw new Error(paymentRes.error?.message || "Receipt/payment not found");
  const { data: doc } = await fetchOne("sales_documents", p.sales_document_id);
  return {
    html: simpleCard("Receipt Voucher", [
      ["Receipt No.", p.payment_number],
      ["Invoice", (doc as any)?.doc_number],
      ["Customer", (doc as any)?.customer_name],
      ["Date", formatDateEnglish(p.date)],
      ["Method", p.method],
      ["Reference", p.reference],
      ["Amount", formatCurrencyEnglish(p.amount, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, "OMR")],
    ]),
    meta: { documentType: "receipt", documentNumber: p.payment_number, title: `Receipt ${p.payment_number}` },
  };
}

async function loadWorkOrder(id: string): Promise<LoadedPdf> {
  const { jo, cust, veh, tok } = await loadWorkOrderBundle(id);
  if ((tok as any)?.token) await buildTrackingQrDataUrl((tok as any).token);
  const html = getWorkOrderHtml({
    orderNumber: jo.order_number || jo.id,
    workOrderType: jo.work_order_type || (jo.insurance_claim_number ? "insurance" : "general_customer"),
    trackingToken: (tok as any)?.token,
    date: jo.entry_date || jo.created_at,
    customerName: (cust as any)?.name || jo.customer_name || "—",
    customerPhone: (cust as any)?.phone || "",
    vehicleType: [((veh as any)?.brand || jo.vehicle_make), ((veh as any)?.model || jo.vehicle_model)].filter(Boolean).join(" ") || "—",
    model: (veh as any)?.model || jo.vehicle_model || "",
    year: String((veh as any)?.year || jo.vehicle_year || ""),
    plateNumber: [((veh as any)?.plate_letters), ((veh as any)?.plate_number || jo.vehicle_plate)].filter(Boolean).join(" ") || "—",
    vin: (veh as any)?.vin_number || jo.vehicle_vin || "",
    insurance: jo.insurance_company || "",
    claimNumber: jo.insurance_claim_number || "",
    serviceType: jo.service_type || jo.description || "",
    technician: jo.technician || "",
    status: jo.status || "",
    totalCost: Number(jo.total_cost || jo.total || 0),
    description: jo.diagnosis || jo.description || "",
    color: (veh as any)?.color || jo.vehicle_color || "",
    mileage: String((veh as any)?.mileage || jo.mileage || ""),
    laborCost: Number(jo.labor_cost || 0),
    partsCost: Number(jo.parts_cost || 0),
    photos: Array.isArray(jo.photos) ? jo.photos.map((p: any) => ({ phase: p.phase, dataUrl: p.url || p.dataUrl, caption: p.caption })) : [],
    customerSignatureDataUrl: (tok as any)?.signature_data_url || undefined,
    customerSignatureName: (tok as any)?.signer_name || undefined,
    customerSignatureDate: (tok as any)?.signed_at ? formatDateTimeEnglish((tok as any).signed_at) : undefined,
  } as any);
  return { html, meta: { documentType: "work-order", documentNumber: jo.order_number, title: `Work Order ${jo.order_number}` } };
}

async function loadQrLabel(id: string): Promise<LoadedPdf> {
  let token = id;
  const title = "QR Label";
  const { data: tok } = await supabase.from("customer_portal_tokens" as any).select("token,job_order_id").eq("job_order_id", id).maybeSingle();
  if ((tok as any)?.token) token = (tok as any).token;
  const qr = await buildTrackingQrDataUrl(token);
  const url = `${window.location.origin}/p/${encodeURIComponent(token)}`;
  const html = `<section class="pdf-v2-card" data-pdf-layout="qr-label" style="text-align:center"><h2>${e(title)}</h2><img src="${qr}" style="width:48mm;height:48mm"/><p style="font-size:8pt;word-break:break-all">${e(url)}</p></section>`;
  return { html, meta: { documentType: "qr-label", documentNumber: "QR", title, layout: "qr-label" } };
}

async function loadInsuranceInvoice(id: string): Promise<LoadedPdf> {
  const { data: inv, error } = await fetchOne("insurance_invoices", id);
  if (error || !inv) throw new Error(error?.message || "Insurance invoice not found");
  const [{ data: claim }, { data: company }] = await Promise.all([
    inv.claim_id ? supabase.from("insurance_claims" as any).select("*").eq("id", inv.claim_id).maybeSingle() : Promise.resolve({ data: null } as any),
    inv.insurance_company_id ? supabase.from("insurance_companies" as any).select("*").eq("id", inv.insurance_company_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ]);
  let qrDataUrl = "";
  try {
    const tpl = await import("@/lib/pdfGenerator").then((m) => m.getTemplateSettings());
    qrDataUrl = await buildZatcaQrDataUrl({
      sellerName: tpl.companyName,
      vatNumber: tpl.vatNumber,
      timestamp: new Date(inv.invoice_date || inv.issued_at || inv.created_at || Date.now()).toISOString(),
      total: Number(inv.total || 0),
      vat: Number(inv.vat || 0),
    });
  } catch {
    qrDataUrl = "";
  }
  const subtotal = Number(inv.subtotal || Math.max(0, Number(inv.total || 0) - Number(inv.vat || 0)));
  const html = getInsuranceTaxInvoiceHtml({
    docType: "invoice",
    template: "default",
    number: inv.invoice_number || inv.id,
    invoiceNumber: inv.invoice_number || inv.id,
    issueDate: formatDateEnglish(inv.invoice_date || inv.issued_at || inv.created_at),
    paymentDueDate: formatDateEnglish(inv.due_date || inv.invoice_date || inv.issued_at || inv.created_at),
    customerName: inv.insurance_company_name || (company as any)?.name || "Insurance Company",
    customFields: [],
    items: Array.isArray(inv.items) && inv.items.length ? inv.items.map((it: any) => ({
      description: it.description || "Insurance repair service",
      quantity: Number(it.quantity || 1),
      unitPrice: Number(it.unit_price || it.unitPrice || subtotal),
      discount: 0,
      tax: 5,
    })) : [{ description: `Insurance repair service ${((claim as any)?.claim_number || "")}`, quantity: 1, unitPrice: subtotal, discount: 0, tax: 5 }],
    subtotal,
    discountTotal: 0,
    taxTotal: Number(inv.vat || 0),
    total: Number(inv.total || 0),
    notes: inv.notes || undefined,
    insuranceCompany: inv.insurance_company_name || (company as any)?.name || "—",
    claimNumber: (claim as any)?.claim_number || inv.claim_number || "",
    vehiclePlate: inv.vehicle_plate || (claim as any)?.vehicle_plate || "",
    vehicleInfo: [inv.vehicle_make, inv.vehicle_model].filter(Boolean).join(" ") || "",
    insuranceCommercialRegistration: (company as any)?.commercial_registration ?? undefined,
    insuranceTaxNumber: (company as any)?.tax_number ?? undefined,
    insurancePoBox: (company as any)?.po_box ?? undefined,
    insuranceBranchCity: (company as any)?.branch_city ?? undefined,
    insuranceAddress: (company as any)?.address ?? undefined,
    insurancePhone: (company as any)?.phone ?? undefined,
    insuranceEmail: (company as any)?.email ?? undefined,
    qrDataUrl,
    lpoNumber: inv.lpo_number || undefined,
  } as any);
  return { html, meta: { documentType: "insurance-invoice", documentNumber: inv.invoice_number, title: `Insurance Invoice ${inv.invoice_number}` } };
}

async function loadClaimReport(id: string): Promise<LoadedPdf> {
  const { data: claim, error } = await fetchOne("insurance_claims", id);
  if (error || !claim) throw new Error(error?.message || "Claim not found");
  const html = simpleCard("Claim Report", [
    ["Claim No.", claim.claim_number],
    ["Insurance Company", claim.insurance_company],
    ["Customer", claim.customer_name],
    ["Vehicle", [claim.vehicle_make, claim.vehicle_model].filter(Boolean).join(" ")],
    ["Plate", claim.vehicle_plate],
    ["Status", claim.status],
    ["Approved Amount", formatCurrencyEnglish(claim.approved_amount || claim.approval_amount || claim.estimated_cost || 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 }, "OMR")],
  ]);
  return { html, meta: { documentType: "claim-report", documentNumber: claim.claim_number, title: `Claim Report ${claim.claim_number}` } };
}

async function loadVehicleHandover(id: string): Promise<LoadedPdf> {
  const { jo, cust, veh } = await loadWorkOrderBundle(id);
  const number = jo.order_number || id;
  const html = getVehicleDeliveryReceiptHtml({
    receiptNumber: `HANDOVER-${number}`,
    date: jo.delivery_date || jo.completed_at || new Date().toISOString().slice(0, 10),
    workOrderNumber: number,
    customerName: (cust as any)?.name || jo.customer_name || "—",
    vehicleType: [((veh as any)?.brand || jo.vehicle_make), ((veh as any)?.model || jo.vehicle_model)].filter(Boolean).join(" ") || "—",
    plateNumber: [((veh as any)?.plate_letters), ((veh as any)?.plate_number || jo.vehicle_plate)].filter(Boolean).join(" ") || "—",
  });
  return { html, meta: { documentType: "vehicle-handover", documentNumber: `HANDOVER-${number}`, title: `Vehicle Handover ${number}` } };
}

async function loadPdfDocument(documentType: PdfV2DocumentType, id: string): Promise<LoadedPdf> {
  switch (documentType) {
    case "cash-invoice": return loadSalesInvoice(id);
    case "receipt": return loadReceipt(id);
    case "work-order": return loadWorkOrder(id);
    case "qr-label": return loadQrLabel(id);
    case "insurance-invoice": return loadInsuranceInvoice(id);
    case "claim-report": return loadClaimReport(id);
    case "vehicle-handover": return loadVehicleHandover(id);
    case "vat-report":
    case "profit-loss":
    case "statement":
    case "report":
      return { html: simpleCard(documentType, [["Generated", formatDateTimeEnglish(new Date().toISOString())]]), meta: { documentType, documentNumber: id, title: documentType, layout: "a4-landscape" } };
    default:
      return { html: simpleCard("Document", [["Type", documentType], ["ID", id]]), meta: { documentType: "generic", documentNumber: id, title: "Document" } };
  }
}

export default function PdfV2PreviewPage() {
  const navigate = useNavigate();
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const { documentType = "generic", id = "preview" } = useParams();
  const [search] = useSearchParams();
  const pdfOnly = window.location.pathname.startsWith("/pdf/");
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const htmlFromSearch = search.get("html") ? decodeURIComponent(search.get("html") || "") : "";
  const html = htmlFromSearch || loaded?.html || "";
  const meta = useMemo(() => ({
    documentType: (loaded?.meta.documentType || documentType) as PdfV2DocumentType,
    documentNumber: loaded?.meta.documentNumber || id,
    title: loaded?.meta.title || search.get("title") || documentType,
    language: (search.get("lang") === "en" ? "en" : "ar") as "ar" | "en",
    layout: (search.get("layout") as any) || loaded?.meta.layout || undefined,
  }), [loaded, documentType, id, search]);
  const srcDoc = useMemo(() => buildPdfV2Html({ html, meta }), [html, meta]);

  useEffect(() => {
    if (htmlFromSearch) return;
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    loadPdfDocument(documentType as PdfV2DocumentType, id)
      .then((doc) => { if (!cancelled) setLoaded(doc); })
      .catch((error) => { if (!cancelled) setLoadError(error?.message || "Unable to load PDF document"); });
    return () => { cancelled = true; };
  }, [documentType, id, htmlFromSearch]);

  useEffect(() => {
    if (!pdfOnly || !html) return;
    createPdfV2Blob({ html, meta })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        window.location.replace(url);
      })
      .catch(() => undefined);
  }, [html, meta, pdfOnly]);

  const printPreview = () => {
    const frameWindow = previewFrameRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.focus();
    frameWindow.print();
  };

  if (!html && !loadError) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading PDF data...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md rounded-xl border bg-card p-5 text-center shadow-sm">
          <h1 className="font-bold text-destructive">PDF document failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>Back</Button>
        </div>
      </div>
    );
  }

  if (pdfOnly) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center text-sm">
        Generating PDF...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40 flex flex-col">
      <div className="pdf-v2-toolbar sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 p-3">
        <Button variant="outline" onClick={() => navigate(-1)} className="gap-2"><ArrowLeft size={16} /> Back</Button>
        <div className="flex-1 font-semibold">{meta.title}</div>
        <Button variant="outline" onClick={printPreview} className="gap-2"><Printer size={16} /> Print</Button>
        <Button variant="outline" onClick={() => void openPdfV2Viewer({ html, meta })} className="gap-2">Open PDF</Button>
        <Button onClick={() => void downloadPdfV2({ html, meta }, `${documentType}-${id}`)} className="gap-2"><Download size={16} /> Download PDF</Button>
      </div>
      <iframe ref={previewFrameRef} title="PDF v2 preview" srcDoc={srcDoc} className="flex-1 w-full border-0" />
    </div>
  );
}
