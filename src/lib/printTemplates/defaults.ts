// Default system templates for each document type
import { newBlockId, type TemplateSchema, type DocType, DEFAULT_PAGE, type BlockZone } from "./schema";

const block = (type: any, props: any = {}, style: any = {}, zone: BlockZone = "body") =>
  ({ id: newBlockId(), type, props, style, zone });

export function defaultSchemaFor(docType: DocType): TemplateSchema {
  const page = { ...DEFAULT_PAGE };

  switch (docType) {
    case "tax_invoice":
    case "insurance_tax_invoice": {
      const isInsurance = docType === "insurance_tax_invoice";
      return {
        version: 1,
        page: { ...page, primaryColor: "#0f172a" },
        blocks: [
          block("header", { logoSize: 22 }, { paddingBottom: 4 }, "header"),
          block("title", {
            text: isInsurance ? "فاتورة ضريبية - تأمين" : "فاتورة ضريبية",
            textEn: isInsurance ? "INSURANCE TAX INVOICE" : "TAX INVOICE",
          }, { color: "#0f172a", fontSize: 14, marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: isInsurance ? [
              { label: "رقم الفاتورة", labelEn: "Invoice No.", bind: "invoiceNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "شركة التأمين", labelEn: "Insurance Co.", bind: "insuranceCompany" },
              { label: "رقم المطالبة", labelEn: "Claim No.", bind: "claimNumber" },
              { label: "الماركة", labelEn: "Make", bind: "vehicleMake" },
              { label: "الموديل", labelEn: "Model", bind: "vehicleModel" },
              { label: "اللوحة", labelEn: "Plate", bind: "vehiclePlate" },
              { label: "تاريخ الاستحقاق", labelEn: "Due Date", bind: "dueDate" },
            ] : [
              { label: "رقم الفاتورة", labelEn: "Invoice No.", bind: "invoiceNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "العميل", labelEn: "Customer", bind: "customerName" },
              { label: "الهاتف", labelEn: "Phone", bind: "customerPhone" },
              { label: "المركبة", labelEn: "Vehicle", bind: "vehicleInfo" },
              { label: "اللوحة", labelEn: "Plate", bind: "plateNumber" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("items_table", {
            showRowNumbers: true,
            zebra: true,
            columnsConfig: [
              { key: "description", label: "البيان", labelEn: "Description", align: "right" },
              { key: "quantity", label: "الكمية", labelEn: "Qty", width: 12, align: "center" },
              { key: "unitPrice", label: "السعر", labelEn: "Unit Price", width: 18, align: "center" },
              { key: "total", label: "الإجمالي", labelEn: "Total", width: 20, align: "center" },
            ],
          }, { color: "#0f172a" }),
          block("spacer", { size: 3 }),
          block("totals", {}, { color: "#0f172a" }),
          ...(isInsurance ? [block("estimation_badge", { badgeText: "LUMP SUM" }, { color: "#dc2626", marginTop: 3 })] : []),
          block("spacer", { size: 6 }),
          block("stamp", { stampSize: 28, signatureLabel: "توقيع المسؤول / Authorized Signature" }, {}, "footer"),
          block("qr_zatca", { qrSize: 26 }, {}, "footer"),
          block("footer", { text: "شكراً لتعاملكم معنا · Thank you for your business" }, {}, "footer"),
        ],
      };
    }

    case "quote":
      return {
        version: 1,
        page: { ...page, primaryColor: "#1e40af" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "عرض سعر", textEn: "QUOTATION" }, { color: "#1e40af", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم العرض", labelEn: "Quote No.", bind: "quoteNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "العميل", labelEn: "Customer", bind: "customerName" },
              { label: "الهاتف", labelEn: "Phone", bind: "customerPhone" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("items_table", { showRowNumbers: true, zebra: true }, { color: "#1e40af" }),
          block("spacer", { size: 3 }),
          block("totals", {}, { color: "#1e40af" }),
          block("spacer", { size: 6 }),
          block("stamp", {}, {}, "footer"),
          block("footer", { text: "صالح لمدة 7 أيام · Valid for 7 days" }, {}, "footer"),
        ],
      };

    case "work_order":
      return {
        version: 1,
        page: { ...page, primaryColor: "#7c3aed" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "أمر عمل", textEn: "WORK ORDER" }, { color: "#7c3aed", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم الأمر", labelEn: "Order No.", bind: "orderNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "العميل", labelEn: "Customer", bind: "customerName" },
              { label: "الهاتف", labelEn: "Phone", bind: "customerPhone" },
              { label: "المركبة", labelEn: "Vehicle", bind: "vehicleType" },
              { label: "الموديل", labelEn: "Model", bind: "model" },
              { label: "اللوحة", labelEn: "Plate", bind: "plateNumber" },
              { label: "الحالة", labelEn: "Status", bind: "status" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("text", { text: "الوصف: {{description}}" }, { fontSize: 10, paddingBottom: 3 }),
          block("totals", {
            totalsItems: [
              { label: "تكلفة العمالة", labelEn: "Labor", bind: "laborCost" },
              { label: "تكلفة القطع", labelEn: "Parts", bind: "partsCost" },
              { label: "الإجمالي", labelEn: "Total", bind: "totalCost", bold: true },
            ],
          }, { color: "#7c3aed" }),
          block("spacer", { size: 6 }),
          block("stamp", {}, {}, "footer"),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "claim_estimate":
      return {
        version: 1,
        page: { ...page, primaryColor: "#be185d" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "تقدير مطالبة", textEn: "CLAIM ESTIMATE" }, { color: "#be185d", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم المطالبة", labelEn: "Claim No.", bind: "claimNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "شركة التأمين", labelEn: "Insurance Co.", bind: "insuranceCompany" },
              { label: "رقم البوليصة", labelEn: "Policy No.", bind: "policyNumber" },
              { label: "الماركة", labelEn: "Make", bind: "vehicleMake" },
              { label: "الموديل", labelEn: "Model", bind: "vehicleModel" },
              { label: "اللوحة", labelEn: "Plate", bind: "vehiclePlate" },
              { label: "السنة", labelEn: "Year", bind: "vehicleYear" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("items_table", { showRowNumbers: true, zebra: true }, { color: "#be185d" }),
          block("spacer", { size: 3 }),
          block("totals", {}, { color: "#be185d" }),
          block("estimation_badge", {}, { color: "#dc2626", marginTop: 3 }),
          block("spacer", { size: 6 }),
          block("stamp", {}, {}, "footer"),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "delivery_proof":
      return {
        version: 1,
        page: { ...page, primaryColor: "#15803d" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "محضر تسليم مركبة", textEn: "VEHICLE DELIVERY PROOF" }, { color: "#15803d", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم المطالبة", labelEn: "Claim No.", bind: "claimNumber" },
              { label: "تاريخ التسليم", labelEn: "Delivery Date", bind: "deliveredAt" },
              { label: "اسم المستلم", labelEn: "Receiver", bind: "receiverName" },
              { label: "رقم الهوية", labelEn: "ID No.", bind: "receiverIdNumber" },
              { label: "الماركة", labelEn: "Make", bind: "vehicleMake" },
              { label: "الموديل", labelEn: "Model", bind: "vehicleModel" },
              { label: "اللوحة", labelEn: "Plate", bind: "vehiclePlate" },
            ],
          }),
          block("text", { text: "ملاحظات: {{deliveryNotes}}" }, { fontSize: 10, paddingTop: 3 }),
          block("spacer", { size: 8 }),
          block("stamp", { signatureLabel: "توقيع المستلم / Receiver Signature" }, {}, "footer"),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "inspection":
      return {
        version: 1,
        page: { ...page, primaryColor: "#f59e0b" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "تقرير فحص", textEn: "INSPECTION REPORT" }, { color: "#f59e0b", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم الفحص", labelEn: "Inspection No.", bind: "inspectionId" },
              { label: "أمر العمل", labelEn: "Work Order", bind: "workOrderId" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "العميل", labelEn: "Customer", bind: "customerName" },
              { label: "المركبة", labelEn: "Vehicle", bind: "vehicleInfo" },
              { label: "نوع الضرر", labelEn: "Damage Type", bind: "damageType" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("text", { text: "الملاحظات: {{notes}}" }, { fontSize: 10 }),
          block("spacer", { size: 8 }),
          block("stamp", {}, {}, "footer"),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "payment_voucher":
      return {
        version: 1,
        page: { ...page, primaryColor: "#dc2626" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "سند صرف", textEn: "PAYMENT VOUCHER" }, { color: "#dc2626", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم السند", labelEn: "Voucher No.", bind: "voucherNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "المستفيد", labelEn: "Beneficiary", bind: "beneficiary" },
              { label: "التصنيف", labelEn: "Category", bind: "categoryName" },
              { label: "الخزينة", labelEn: "Cashbox", bind: "cashboxName" },
              { label: "طريقة الدفع", labelEn: "Method", bind: "paymentMethod" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("totals", {
            totalsItems: [{ label: "المبلغ المصروف", labelEn: "Amount Paid", bind: "amount", bold: true }],
          }, { color: "#dc2626" }),
          block("text", { text: "البيان: {{description}}" }, { fontSize: 10, paddingTop: 3 }),
          block("spacer", { size: 8 }),
          block("stamp", {}, {}, "footer"),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "deposit_receipt":
      return {
        version: 1,
        page: { ...page, primaryColor: "#0f766e" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "سند قبض عربون", textEn: "DEPOSIT RECEIPT" }, { color: "#0f766e", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم السند", labelEn: "Receipt No.", bind: "receiptNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "العميل", labelEn: "Customer", bind: "customerName" },
              { label: "الهاتف", labelEn: "Phone", bind: "customerPhone" },
              { label: "اللوحة", labelEn: "Plate", bind: "plateNumber" },
              { label: "طريقة الدفع", labelEn: "Method", bind: "paymentMethod" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("totals", {
            totalsItems: [{ label: "المبلغ المستلم", labelEn: "Amount Received", bind: "amount", bold: true }],
          }, { color: "#0f766e" }),
          block("text", { text: "ملاحظات: {{notes}}" }, { fontSize: 10, paddingTop: 3 }),
          block("spacer", { size: 8 }),
          block("stamp", {}, {}, "footer"),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "vehicle_card":
      return {
        version: 1,
        page: { ...page, primaryColor: "#ea580c" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "بطاقة سيارة", textEn: "VEHICLE CARD" }, { color: "#ea580c", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم اللوحة", labelEn: "Plate", bind: "plate" },
              { label: "النوع/الموديل", labelEn: "Make/Model", bind: "type" },
              { label: "السنة", labelEn: "Year", bind: "year" },
              { label: "اللون", labelEn: "Color", bind: "color" },
              { label: "رقم الهيكل", labelEn: "VIN", bind: "vin" },
              { label: "الممشى", labelEn: "Mileage", bind: "mileage" },
              { label: "المالك", labelEn: "Owner", bind: "owner" },
              { label: "الهاتف", labelEn: "Phone", bind: "ownerPhone" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("totals", {
            totalsItems: [
              { label: "عدد الزيارات", labelEn: "Visits", bind: "visits" },
              { label: "إجمالي الإنفاق", labelEn: "Total Spent", bind: "totalSpent", bold: true },
            ],
          }, { color: "#ea580c" }),
          block("spacer", { size: 6 }),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "stage_photos_album":
      return {
        version: 1,
        page: { ...page, primaryColor: "#9333ea" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "ألبوم صور المراحل", textEn: "STAGE PHOTOS ALBUM" }, { color: "#9333ea", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "اللوحة", labelEn: "Plate", bind: "vehiclePlate" },
              { label: "النوع", labelEn: "Vehicle", bind: "vehicleType" },
              { label: "المالك", labelEn: "Owner", bind: "owner" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("text", { text: "ملاحظة: ألبوم الصور التفصيلي يُرفق تلقائياً عند التوليد." }, { fontSize: 9, color: "#6b7280", textAlign: "center" }),
          block("spacer", { size: 6 }),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "needed_parts_request":
      return {
        version: 1,
        page: { ...page, primaryColor: "#ca8a04" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "طلب قطع غيار", textEn: "PARTS REQUEST" }, { color: "#ca8a04", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "رقم الطلب", labelEn: "Request No.", bind: "requestNumber" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("text", { text: "تفاصيل القطع المطلوبة تُلحق تلقائياً عند توليد المستند." }, { fontSize: 9, color: "#6b7280" }),
          block("spacer", { size: 8 }),
          block("stamp", {}, {}, "footer"),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "account_statement":
      return {
        version: 1,
        page: { ...page, primaryColor: "#0d9488" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "كشف حساب عميل", textEn: "CUSTOMER STATEMENT" }, { color: "#0d9488", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "العميل", labelEn: "Customer", bind: "customerName" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "الهاتف", labelEn: "Phone", bind: "customerPhone" },
              { label: "الفترة", labelEn: "Period", bind: "period" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("totals", {
            totalsItems: [
              { label: "إجمالي الفواتير", labelEn: "Total Invoiced", bind: "totalInvoiced" },
              { label: "إجمالي المدفوعات", labelEn: "Total Paid", bind: "totalPaid" },
              { label: "الرصيد", labelEn: "Balance", bind: "balance", bold: true },
            ],
          }, { color: "#0d9488" }),
          block("spacer", { size: 6 }),
          block("footer", {}, {}, "footer"),
        ],
      };

    case "insurance_statement":
      return {
        version: 1,
        page: { ...page, primaryColor: "#4f46e5" },
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "كشف حساب شركة تأمين", textEn: "INSURANCE STATEMENT" }, { color: "#4f46e5", marginTop: 2, marginBottom: 4 }, "header"),
          block("info_grid", {
            columns: 2,
            fields: [
              { label: "شركة التأمين", labelEn: "Insurance Co.", bind: "insuranceCompany" },
              { label: "التاريخ", labelEn: "Date", bind: "date" },
              { label: "الفترة", labelEn: "Period", bind: "period" },
              { label: "عدد المطالبات", labelEn: "Claims", bind: "claimsCount" },
            ],
          }),
          block("spacer", { size: 3 }),
          block("totals", {
            totalsItems: [
              { label: "إجمالي الفواتير", labelEn: "Total Invoiced", bind: "totalInvoiced" },
              { label: "إجمالي المدفوعات", labelEn: "Total Paid", bind: "totalPaid" },
              { label: "الرصيد", labelEn: "Balance", bind: "balance", bold: true },
            ],
          }, { color: "#4f46e5" }),
          block("spacer", { size: 6 }),
          block("footer", {}, {}, "footer"),
        ],
      };

    default:
      return {
        version: 1,
        page,
        blocks: [
          block("header", {}, {}, "header"),
          block("title", { text: "مستند", textEn: "DOCUMENT" }, { marginTop: 2, marginBottom: 4 }, "header"),
          block("spacer", { size: 6 }),
          block("footer", {}, {}, "footer"),
        ],
      };
  }
}
