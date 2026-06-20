---
name: Insurance vs Sales Invoice Separation
description: Insurance work orders must be invoiced from the claim screen only, not from sales — central guard in workOrderInvoiceSync.ts
type: feature
---

## Rule
أوامر العمل المرتبطة بمطالبة تأمين (`insurance` غير "-" أو `claimNumber` غير "-") **يُمنع** إصدار فاتورة مبيعات لها. تُصدر فاتورتها من شاشة المطالبة فقط عبر جدول `insurance_invoices`.

## التطبيق التقني
- **حارس مركزي**: `assertNotInsuranceOrder(order)` و `isInsuranceWorkOrder(order)` في `src/lib/workOrderInvoiceSync.ts`.
- يُستدعى الحارس داخل `syncWorkOrderInvoiceFromExpenses` فيرفع خطأ واضح، فيُغطّي كل المسارات (شاشة التسليم، سندات الصرف الجماعية، إلخ).
- في `VehicleDeliveryReceiptDialog`: زر "إصدار فاتورة ضريبية" يُستبدل تلقائياً بـ "فتح المطالبة لإصدار الفاتورة" للأوامر التأمينية (ينتقل إلى `/insurance/:claimId`).

## ما يبقى موحّداً (لا تكسره)
- `useUnifiedRevenue` — إجمالي الإيراد التنفيذي يجمع النوعين.
- `vatOfficialExport` — إقرار VAT الرسمي يجمع النوعين.
- لوحات KPI التنفيذية.

## ما يُفصل
- شاشات قوائم المبيعات وذمم العملاء (`customerLedger`) ينبغي ألا تتضمن مطالبات التأمين.
- الترقيم منفصل أصلاً: `insurance_invoice_seq` للتأمين، `salesStore.nextNumber("invoice")` للمبيعات.

## سبب الخطر
لو صدرت فاتورتان لنفس العمل → إيراد مزدوج + VAT مكرر + ذمم في طرفين (عملاء + شركة تأمين).
