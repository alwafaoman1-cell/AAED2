// Sample/preview data for each doc type — used in editor preview & variant cards
import type { DocType } from "./schema";

export function sampleDataFor(docType: DocType): any {
  const base = {
    companyName: "ورشة الوفاء للخدمات المتكاملة",
    companyNameEn: "Alwafa Integrated Services",
    companyAddress: "مسقط - عمان · Muscat, Oman",
    companyPhone: "+968 9000 0000",
    companyEmail: "info@alwafa.om",
    vatNumber: "OM1100000000003",
    commercialReg: "1234567",
    currency: "OMR",
    date: new Date().toLocaleDateString("en-GB"),
  };

  switch (docType) {
    case "tax_invoice":
      return {
        ...base,
        invoiceNumber: "INV-00125",
        customerName: "أحمد المعمري",
        customerPhone: "+968 9999 1234",
        vehicleInfo: "Toyota Camry 2022",
        plateNumber: "12345 / A",
        items: [
          { description: "تغيير زيت محرك + فلتر", quantity: 1, unitPrice: 18.5, total: 18.5 },
          { description: "غسيل وتنظيف داخلي", quantity: 1, unitPrice: 7.0, total: 7.0 },
          { description: "فحص شامل", quantity: 1, unitPrice: 5.0, total: 5.0 },
        ],
        subtotal: 30.5, vat: 1.525, total: 32.025,
      };

    case "insurance_tax_invoice":
    case "claim_estimate":
      return {
        ...base,
        invoiceNumber: "INS-INV-00042",
        claimNumber: "CLM-2026-0042",
        insuranceCompany: "شركة عمان الوطنية للتأمين",
        policyNumber: "POL-998877",
        vehicleMake: "Nissan", vehicleModel: "Patrol", vehiclePlate: "55512 / B", vehicleYear: "2023",
        dueDate: "2026-05-26", estimationType: "lump_sum",
        items: [
          { description: "إصلاح الواجهة الأمامية", quantity: 1, unitPrice: 320, total: 320 },
          { description: "صبغ غطاء المحرك", quantity: 1, unitPrice: 85, total: 85 },
          { description: "استبدال مصباح أمامي", quantity: 2, unitPrice: 45, total: 90 },
        ],
        subtotal: 495, vat: 24.75, total: 519.75,
      };

    case "quote":
      return {
        ...base,
        quoteNumber: "QT-00087",
        customerName: "سالم الكندي", customerPhone: "+968 9888 5544",
        items: [
          { description: "إصلاح صدمة خلفية", quantity: 1, unitPrice: 150, total: 150 },
          { description: "صبغ كامل", quantity: 1, unitPrice: 220, total: 220 },
        ],
        subtotal: 370, vat: 18.5, total: 388.5,
      };

    case "work_order":
      return {
        ...base,
        orderNumber: "WO-2026-0125",
        customerName: "أحمد المعمري", customerPhone: "+968 9999 1234",
        vehicleType: "Toyota", model: "Camry 2022", plateNumber: "12345 / A",
        status: "تحت الإصلاح",
        description: "صدمة جانبية يمين + استبدال الباب الأمامي",
        laborCost: 120, partsCost: 380, totalCost: 500,
      };

    case "delivery_proof":
      return {
        ...base,
        claimNumber: "CLM-2026-0042",
        deliveredAt: new Date().toLocaleDateString("en-GB"),
        receiverName: "أحمد المعمري", receiverIdNumber: "12345678",
        vehicleMake: "Nissan", vehicleModel: "Patrol 2023", vehiclePlate: "55512 / B",
        deliveryNotes: "تم تسليم المركبة بحالة جيدة بعد إكمال جميع أعمال الإصلاح.",
      };

    case "inspection":
      return {
        ...base,
        inspectionId: "INSP-00021", workOrderId: "WO-2026-0125",
        customerName: "أحمد المعمري",
        vehicleInfo: "Toyota Camry 2022 — 12345 / A",
        damageType: "صدمة جانبية", photoCount: 6, status: "مكتمل",
        notes: "تم توثيق جميع نقاط الضرر بالصور.",
      };

    case "payment_voucher":
      return {
        ...base,
        voucherNumber: "PV-00033",
        beneficiary: "محمد العبري", categoryName: "مصاريف تشغيل",
        cashboxName: "الخزينة الرئيسية", paymentMethod: "تحويل بنكي",
        amount: 250, description: "صرف ثمن قطع غيار للمورد.",
      };

    case "deposit_receipt":
      return {
        ...base,
        receiptNumber: "DEP-00018",
        customerName: "سالم الكندي", customerPhone: "+968 9888 5544",
        plateNumber: "78901 / C", paymentMethod: "كاش",
        amount: 100, notes: "عربون لإصلاح الصدمة الأمامية.",
      };

    case "vehicle_card":
      return {
        ...base,
        plate: "12345 / A", type: "Toyota Camry",
        year: "2022", color: "أبيض", vin: "JT2BG22K3W0123456", mileage: "85,000 km",
        owner: "أحمد المعمري", ownerPhone: "+968 9999 1234",
        visits: 5, totalSpent: 1250.5, lastVisit: "2026-04-15",
      };

    case "stage_photos_album":
      return {
        ...base,
        vehiclePlate: "12345 / A", vehicleType: "Toyota Camry 2022",
        owner: "أحمد المعمري",
      };

    case "needed_parts_request":
      return {
        ...base,
        requestNumber: "PR-00007",
      };

    case "account_statement":
      return {
        ...base,
        customerName: "أحمد المعمري", customerPhone: "+968 9999 1234",
        period: "01/01/2026 - 30/04/2026",
        totalInvoiced: 1850.5, totalPaid: 1500, balance: 350.5,
      };

    case "insurance_statement":
      return {
        ...base,
        insuranceCompany: "شركة عمان الوطنية للتأمين",
        period: "Q1 2026", claimsCount: 12,
        totalInvoiced: 8500, totalPaid: 7200, balance: 1300,
      };

    default:
      return base;
  }
}
