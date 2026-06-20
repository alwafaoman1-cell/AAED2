// Registry of all document types in the system
import type { DocType } from "./schema";
import {
  FileText, Receipt, ClipboardList, Search, Shield, Truck,
  Wallet, PiggyBank, Car, Camera, Package, FileBarChart, Building2, FileCheck,
} from "lucide-react";

export interface DocTypeMeta {
  type: DocType;
  nameAr: string;
  nameEn: string;
  description: string;
  icon: any;
  color: string;
  category: "sales" | "operations" | "insurance" | "accounting" | "reports";
}

export const DOC_TYPES: DocTypeMeta[] = [
  { type: "tax_invoice",          nameAr: "الفاتورة الضريبية",       nameEn: "Tax Invoice",            description: "فاتورة المبيعات الرسمية مع ضريبة القيمة المضافة وZATCA QR", icon: Receipt,        color: "#10b981", category: "sales" },
  { type: "quote",                nameAr: "عرض السعر",                nameEn: "Quotation",              description: "عرض سعر للعميل قبل بدء العمل",                              icon: FileText,        color: "#3b82f6", category: "sales" },
  { type: "work_order",           nameAr: "أمر العمل",                nameEn: "Work Order",             description: "أمر تشغيل تفصيلي للورشة مع المراحل والقطع",                  icon: ClipboardList,   color: "#8b5cf6", category: "operations" },
  { type: "inspection",           nameAr: "تقرير الفحص",              nameEn: "Inspection Report",      description: "تقرير فحص فني مع نقاط الأضرار والصور",                       icon: Search,          color: "#f59e0b", category: "operations" },
  { type: "insurance_tax_invoice",nameAr: "فاتورة التأمين الضريبية",  nameEn: "Insurance Tax Invoice",  description: "فاتورة موجهة لشركة التأمين مع ZATCA QR",                     icon: Shield,          color: "#06b6d4", category: "insurance" },
  { type: "claim_estimate",       nameAr: "تقدير المطالبة",           nameEn: "Claim Estimate",         description: "تقدير تكلفة الإصلاح المرسل لشركة التأمين (LUMP SUM / UPL)",  icon: FileBarChart,    color: "#ec4899", category: "insurance" },
  { type: "delivery_proof",       nameAr: "محضر تسليم المركبة",       nameEn: "Delivery Proof",         description: "إقرار استلام المركبة بعد الإصلاح",                            icon: Truck,           color: "#22c55e", category: "insurance" },
  { type: "payment_voucher",      nameAr: "سند قبض / صرف",            nameEn: "Payment Voucher",        description: "سند مالي لاستلام أو صرف المبالغ",                            icon: Wallet,          color: "#0ea5e9", category: "accounting" },
  { type: "deposit_receipt",      nameAr: "سند إيداع",                nameEn: "Deposit Receipt",        description: "سند استلام دفعة مقدمة من العميل",                            icon: PiggyBank,       color: "#84cc16", category: "accounting" },
  { type: "vehicle_card",         nameAr: "كرت السيارة",              nameEn: "Vehicle Card",           description: "بطاقة تعريفية للمركبة مع QR للتتبع",                          icon: Car,             color: "#f97316", category: "operations" },
  { type: "stage_photos_album",   nameAr: "ألبوم صور المراحل",        nameEn: "Stage Photos Album",     description: "ألبوم صور لمراحل الإصلاح المختلفة",                          icon: Camera,          color: "#a855f7", category: "operations" },
  { type: "needed_parts_request", nameAr: "طلب قطع الغيار",           nameEn: "Parts Request",          description: "طلب توريد قطع غيار للموردين",                                icon: Package,         color: "#eab308", category: "operations" },
  { type: "account_statement",    nameAr: "كشف حساب عميل",            nameEn: "Customer Statement",     description: "كشف حساب تفصيلي بحركات العميل",                              icon: FileCheck,       color: "#14b8a6", category: "reports" },
  { type: "insurance_statement",  nameAr: "كشف حساب شركة تأمين",      nameEn: "Insurance Statement",    description: "كشف حساب لشركة التأمين بالمدفوعات والفواتير",                icon: Building2,       color: "#6366f1", category: "reports" },
];

export const CATEGORY_LABELS: Record<string, { ar: string; en: string }> = {
  sales:      { ar: "المبيعات",   en: "Sales" },
  operations: { ar: "العمليات",   en: "Operations" },
  insurance:  { ar: "التأمين",    en: "Insurance" },
  accounting: { ar: "المحاسبة",   en: "Accounting" },
  reports:    { ar: "التقارير",   en: "Reports" },
};

export const getDocTypeMeta = (t: DocType): DocTypeMeta =>
  DOC_TYPES.find((d) => d.type === t) || DOC_TYPES[0];
