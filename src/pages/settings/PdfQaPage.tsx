import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileCheck2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { smartBack } from "@/lib/smartBack";
import { getInvoiceHtml, getPaymentVoucherHtml, getWorkOrderHtml } from "@/lib/pdfGenerator";
import { getClaimTaxInvoiceHtml } from "@/lib/insurancePdfTemplates";
import { buildClaimArchiveHtml } from "@/lib/claimArchivePdf";

type QaDocument = "insurance" | "sales" | "archive" | "work-order" | "voucher";

const sampleImage = (label: string, color: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
      <rect width="100%" height="100%" fill="${color}"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-family="Arial" font-size="48" fill="white">${label}</text>
    </svg>
  `)}`;

export default function PdfQaPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<QaDocument | null>(null);
  const [preview, setPreview] = useState<{ html: string; title: string; fileName: string } | null>(null);

  async function openDocument(kind: QaDocument) {
    setLoading(kind);
    try {
      if (kind === "insurance") {
        const html = await getClaimTaxInvoiceHtml({
          invoiceNumber: "INS-QA-0001",
          invoiceDate: "2026-06-21",
          dueDate: "2026-09-19",
          claimNumber: "CLM-QA-0001",
          insuranceCompany: "PDF QA Insurance Company",
          vehicle: { make: "Toyota", model: "Camry", plate: "12345 OM", year: 2024, color: "White", vin: "QA123456789012345" },
          customerName: "PDF QA Customer",
          items: Array.from({ length: 24 }, (_, i) => ({
            description: `Insurance repair item ${i + 1}`,
            quantity: 1,
            unit_price: 10 + i,
          })),
          vatRate: 5,
          verifyUrl: `${window.location.origin}/invoice/view/pdf-qa`,
        });
        setPreview({ html, title: "QA - Insurance Invoice", fileName: "qa-insurance-invoice" });
      } else if (kind === "sales") {
        const items = Array.from({ length: 30 }, (_, i) => ({
          description: `Sales invoice item ${i + 1}`,
          quantity: 1,
          unitPrice: 5 + i,
          total: 5 + i,
        }));
        const subtotal = items.reduce((sum, item) => sum + item.total, 0);
        setPreview({
          html: getInvoiceHtml({
            invoiceNumber: "INV-QA-0001",
            date: "2026-06-21",
            customerName: "PDF QA Customer",
            customerPhone: "+968 9000 0000",
            vehicleInfo: "Toyota Camry 2024",
            plateNumber: "12345 OM",
            items,
            subtotal,
            vat: subtotal * 0.05,
            total: subtotal * 1.05,
            notes: "QA document with enough rows to verify controlled page breaks.",
          }),
          title: "QA - Sales Invoice",
          fileName: "qa-sales-invoice",
        });
      } else if (kind === "archive") {
        const files = Array.from({ length: 20 }, (_, i) => ({
          url: sampleImage(`Claim photo ${i + 1}`, i % 2 ? "#0369a1" : "#7c3aed"),
          name: `claim-photo-${i + 1}.svg`,
          kind: "image" as const,
        }));
        const html = await buildClaimArchiveHtml({
          claim: {
            claim_number: "CLM-QA-0001",
            insurance_company: "PDF QA Insurance Company",
            status: "approved",
            estimation_type: "upl",
            estimated_amount: 1250,
            approved_amount: 1100,
            created_at: new Date().toISOString(),
            customer: { name: "PDF QA Customer", phone: "+968 9000 0000" },
            vehicle: { brand: "Toyota", model: "Camry", plate_number: "12345 OM", year: 2024 },
          },
          workOrder: { order_number: "WO-QA-0001", status: "in_progress", description: "QA work order", diagnosis: "QA diagnosis" },
          invoices: [{ invoice_number: "INS-QA-0001", total: 1155, status: "issued", issued_at: new Date().toISOString() }],
          payments: [{ payment_number: "PAY-QA-0001", amount: 500, payment_method: "bank_transfer", payment_date: "2026-06-21", status: "cleared" }],
          sections: [{ title: "صور الاختبار", titleEn: "QA Photos", files }],
        });
        setPreview({ html, title: "QA - Claim Archive", fileName: "qa-claim-archive" });
      } else if (kind === "work-order") {
        setPreview({
          html: getWorkOrderHtml({
            orderNumber: "WO-QA-0001",
            date: "2026-06-21",
            customerName: "PDF QA Customer",
            customerPhone: "+968 9000 0000",
            vehicleType: "Toyota",
            model: "Camry",
            year: "2024",
            plateNumber: "12345 OM",
            vin: "QA123456789012345",
            insurance: "PDF QA Insurance Company",
            claimNumber: "CLM-QA-0001",
            serviceType: "Body repair",
            technician: "QA Technician",
            status: "تحت الإصلاح",
            totalCost: 1200,
            laborCost: 600,
            partsCost: 500,
            extraExpenses: [{ label: "Towing", amount: 100 }],
            description: "Long QA work order used to verify page boundaries and photo grouping.",
            photos: Array.from({ length: 18 }, (_, i) => ({
              phase: i < 6 ? "received" : i < 12 ? "in_progress" : "quality",
              dataUrl: sampleImage(`WO photo ${i + 1}`, i % 2 ? "#b45309" : "#047857"),
              caption: `Controlled QA photo ${i + 1}`,
            })),
          }),
          title: "QA - Work Order",
          fileName: "qa-work-order",
        });
      } else {
        setPreview({
          html: getPaymentVoucherHtml({
            voucherNumber: "PV-QA-0001",
            date: "2026-06-21",
            amount: 250,
            categoryName: "QA expense",
            cashboxName: "Main cashbox",
            paymentMethod: "Bank transfer",
            beneficiary: "PDF QA Supplier",
            description: "QA voucher with a receipt image.",
            photo: sampleImage("Payment receipt", "#be123c"),
          }),
          title: "QA - Payment Voucher",
          fileName: "qa-payment-voucher",
        });
      }
    } finally {
      setLoading(null);
    }
  }

  const documents: { kind: QaDocument; title: string; description: string }[] = [
    { kind: "insurance", title: "Insurance invoice", description: "Long item table, QR, insurer and workshop logos." },
    { kind: "sales", title: "Sales invoice", description: "Long item table, totals, signatures, header and footer." },
    { kind: "archive", title: "Claim archive", description: "Claim data, invoices, payments and 20 photos." },
    { kind: "work-order", title: "Work order", description: "Status timeline, costs, signatures and 18 photos." },
    { kind: "voucher", title: "Payment voucher", description: "Header, amount, signatures and receipt image." },
  ];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings/pdf-layout")}>
          <ArrowLeft className="rtl:rotate-180" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCheck2 className="text-primary" /> PDF QA Checklist
          </h1>
          <p className="text-sm text-muted-foreground">بيانات داخلية تجريبية فقط، دون قراءة أو كتابة Supabase.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {documents.map((item) => (
          <div key={item.kind} className="rounded-xl border bg-card p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-500" /> {item.title}</div>
              <div className="text-xs text-muted-foreground mt-1">{item.description}</div>
            </div>
            <Button size="sm" onClick={() => openDocument(item.kind)} disabled={loading !== null}>
              {loading === item.kind ? <Loader2 size={14} className="animate-spin" /> : "فتح الاختبار"}
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-muted/30 p-4 text-sm">
        <div className="font-semibold mb-2">Checklist</div>
        <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
          <li>حدود A4 ظاهرة كصفحات منفصلة.</li>
          <li>لا يظهر تنبيه عنصر أكبر من A4.</li>
          <li>الرأس والتذييل والشعار والهوامش ثابتة.</li>
          <li>الصفوف والصور لا تُقص في منتصفها.</li>
          <li>اختبر معاينة طباعة المتصفح وتنزيل PDF وتصدير البيانات فقط.</li>
        </ul>
      </div>

      {preview && (
        <PdfPreviewDialog
          open={!!preview}
          onOpenChange={(open) => !open && setPreview(null)}
          htmlContent={preview.html}
          title={preview.title}
          fileName={preview.fileName}
        />
      )}
    </div>
  );
}
