import { useState, useMemo } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, FileBarChart, FileText, FileSpreadsheet, Download, Upload,
  ShoppingCart, Building2, TrendingUp, Receipt, Car, Package,
  ArrowDownUp, ClipboardList, Users, BookOpen, BookCheck, Search,
  ShieldCheck, Wallet, Wrench, MinusCircle, FilePlus2, Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface ExportItem {
  key: string;
  title: string;
  description: string;
  icon: any;
  group: "sales" | "purchases" | "insurance" | "workorders" | "inventory" | "accounting" | "hr";
  /** المسار الذي يحتوي على زر التصدير الفعلي */
  route: string;
  /** نوع المستخرج */
  format: "pdf" | "excel" | "csv" | "report";
  badge?: string;
}

const ITEMS: ExportItem[] = [
  // ===== مبيعات =====
  { key: "sales-invoices", title: "فواتير المبيعات", description: "كل الفواتير بصيغة PDF — فلترة بالتاريخ والعميل", icon: Receipt, group: "sales", route: "/sales/invoices", format: "pdf" },
  { key: "sales-quotes", title: "عروض الأسعار", description: "تصدير وطباعة عروض الأسعار", icon: FileText, group: "sales", route: "/sales/quotes", format: "pdf" },
  { key: "credit-notes", title: "إشعارات الخصم/الائتمان", description: "كل الإشعارات الدائنة", icon: FileText, group: "sales", route: "/sales/credit-notes", format: "pdf" },
  { key: "sales-returns", title: "مرتجعات المبيعات", description: "تقارير المرتجعات", icon: FileText, group: "sales", route: "/sales/returns", format: "pdf" },
  { key: "customer-payments", title: "دفعات العملاء", description: "كشف بدفعات العملاء", icon: Wallet, group: "sales", route: "/sales/payments", format: "report" },
  { key: "sales-report", title: "تقرير المبيعات الكامل", description: "إيرادات، مدفوع، معلق + تصدير Excel", icon: ShoppingCart, group: "sales", route: "/reports?tab=financial&report=sales", format: "excel", badge: "Excel" },

  // ===== مشتريات =====
  { key: "purchase-invoices", title: "فواتير المشتريات", description: "فواتير الموردين بصيغة PDF", icon: Building2, group: "purchases", route: "/inventory/purchase-invoices", format: "pdf" },
  { key: "purchase-returns", title: "مرتجعات المشتريات", description: "كل مرتجعات الموردين", icon: FileText, group: "purchases", route: "/inventory/purchase-returns", format: "pdf" },
  { key: "supplier-payments", title: "دفعات الموردين", description: "كشف بدفعات الموردين", icon: Wallet, group: "purchases", route: "/inventory/supplier-payments", format: "report" },
  { key: "supplier-balance", title: "كشف حساب الموردين", description: "أرصدة الموردين بـ Aging", icon: Building2, group: "purchases", route: "/inventory/supplier-balance", format: "report" },
  { key: "purchase-report", title: "تقرير المشتريات", description: "تقرير شامل + Excel", icon: ShoppingCart, group: "purchases", route: "/reports?tab=financial&report=purchases", format: "excel", badge: "Excel" },

  // ===== التأمين =====
  { key: "ins-invoices", title: "فواتير التأمين الضريبية", description: "Tax Invoice + LPO قابلة للتعديل", icon: ShieldCheck, group: "insurance", route: "/insurance/accounting", format: "pdf" },
  { key: "ins-estimates", title: "تقديرات الإصلاح", description: "كل تقديرات الإصلاح + تحويل لفاتورة", icon: FileText, group: "insurance", route: "/insurance/estimates", format: "pdf" },
  { key: "ins-payments", title: "دفعات شركات التأمين", description: "تحويل/شيك/مقاصة + كشف حساب PDF", icon: Wallet, group: "insurance", route: "/insurance/payments", format: "pdf" },
  { key: "ins-claims", title: "كل المطالبات", description: "قائمة المطالبات + تصدير CSV", icon: ShieldCheck, group: "insurance", route: "/insurance/list", format: "csv", badge: "CSV" },
  { key: "ins-archive", title: "أرشيف وثائق التأمين", description: "كل PDF المطالبات والمرفقات", icon: Archive, group: "insurance", route: "/insurance/documents", format: "pdf" },

  // ===== أوامر العمل =====
  { key: "wo-list", title: "قائمة أوامر العمل", description: "طباعة قائمة بكل أوامر العمل", icon: ClipboardList, group: "workorders", route: "/work-orders", format: "pdf" },
  { key: "wo-parts-request", title: "طلبات شراء قطع الغيار", description: "طلبات قطع الغيار من أوامر العمل", icon: Package, group: "workorders", route: "/work-orders", format: "pdf" },
  { key: "wo-delivery", title: "إقرارات استلام السيارات", description: "PDF إقرار استلام موقّع", icon: FilePlus2, group: "workorders", route: "/work-orders", format: "pdf", badge: "جديد" },
  { key: "wo-inspections", title: "تقارير الفحص", description: "تقارير الفحص العامة وفحوصات التأمين", icon: Wrench, group: "workorders", route: "/inspection", format: "pdf" },
  { key: "wo-report", title: "تقرير أوامر الشغل", description: "تقرير شامل بحالات الأوامر والتكاليف", icon: ClipboardList, group: "workorders", route: "/reports?tab=operational&report=workOrders", format: "excel", badge: "Excel" },
  { key: "wo-statement", title: "كشف حساب أوامر الشغل والصيانة", description: "كشف تفصيلي بكل أمر شغل: تكلفة، عمالة، أجر الزبون، الربح/الخسارة + PDF أفقي", icon: ClipboardList, group: "workorders", route: "/reports/work-orders-statement", format: "pdf", badge: "PDF أفقي" },
  { key: "daily-log", title: "السجل اليومي (نموذج الورشة)", description: "جدول يومي بنفس شكل النموذج — رفع Excel + توليد أمر عمل وفاتورة لكل صف", icon: FileSpreadsheet, group: "workorders", route: "/daily-log", format: "excel", badge: "جديد ⭐" },

  // ===== مخزون =====
  { key: "inv-value", title: "قيمة المخزون", description: "قيمة المخزون والأصناف الناقصة", icon: Package, group: "inventory", route: "/reports?tab=operational&report=inventory", format: "excel", badge: "Excel" },
  { key: "inv-movements", title: "حركات المخزون (IN/OUT)", description: "إدخال/إخراج/تحويل", icon: ArrowDownUp, group: "inventory", route: "/inventory/movements", format: "report" },
  { key: "inv-parts-profit", title: "ربح قطع الغيار", description: "هامش ربح بيع قطع الغيار", icon: TrendingUp, group: "inventory", route: "/reports?tab=financial&report=partsProfit", format: "excel", badge: "Excel" },
  { key: "inv-parts-profit-detailed", title: "تقرير ربح قطع الغيار التفصيلي", description: "كل قطعة: سعر شراء، سعر بيع، الربح، السيارة + PDF أفقي", icon: TrendingUp, group: "inventory", route: "/reports/parts-profit", format: "pdf", badge: "PDF أفقي" },

  // ===== محاسبة =====
  { key: "acc-cloud-advanced", title: "تقارير محاسبية متقدمة (سحابة)", description: "VAT + قائمة الدخل + أعمار الذمم + الاتجاه الشهري — مباشرة من السحابة، محدّثة لحظياً", icon: TrendingUp, group: "accounting", route: "/reports/cloud-advanced", format: "report", badge: "سحابة ⚡" },
  { key: "acc-monthly", title: "التقرير الشهري الشامل", description: "إيرادات + مصروفات + رواتب + إيجار وتكاليف ثابتة + صافي الربح — PDF أفقي احترافي", icon: TrendingUp, group: "accounting", route: "/reports/monthly", format: "report", badge: "جديد ⭐" },
  { key: "acc-pl", title: "الأرباح والخسائر (P&L)", description: "إيرادات - تكاليف - مصروفات", icon: TrendingUp, group: "accounting", route: "/reports?tab=financial&report=pl", format: "excel", badge: "Excel" },
  { key: "acc-vat", title: "ضريبة القيمة المضافة (5%)", description: "الضريبة المخرجة والمدخلة", icon: Receipt, group: "accounting", route: "/reports?tab=financial&report=vat", format: "excel", badge: "Excel" },
  { key: "acc-vehicle-profit", title: "ربح/خسارة لكل سيارة", description: "تحليل تفصيلي لربحية كل أمر شغل", icon: Car, group: "accounting", route: "/reports?tab=financial&report=perVehicle", format: "excel", badge: "Excel" },
  { key: "acc-journal", title: "دفتر اليومية", description: "كل القيود المرحّلة", icon: BookOpen, group: "accounting", route: "/reports?tab=accounting&report=journal", format: "excel", badge: "Excel" },
  { key: "acc-trial", title: "ميزان المراجعة", description: "أرصدة كل الحسابات", icon: BookCheck, group: "accounting", route: "/reports?tab=accounting&report=trialBalance", format: "excel", badge: "Excel" },
  { key: "acc-expenses", title: "تقرير المصروفات", description: "كل سندات الصرف + توزيع التصنيفات", icon: MinusCircle, group: "accounting", route: "/accounting/expenses", format: "report" },
  { key: "acc-expenses-import", title: "استيراد المصروفات من Excel", description: "ارفع ملف مصروفات قديمة — يوزَّع تلقائياً حسب البند والتصنيف", icon: Upload, group: "accounting", route: "/expenses/import", format: "excel", badge: "جديد ⭐" },

  // ===== العملاء والموردون =====
  { key: "customers", title: "كشف حساب العملاء", description: "أرصدة، ودائع، فواتير معلقة", icon: Users, group: "accounting", route: "/reports?tab=relations&report=customers", format: "excel", badge: "Excel" },
];

const GROUP_LABELS: Record<ExportItem["group"], string> = {
  sales: "المبيعات",
  purchases: "المشتريات",
  insurance: "التأمين",
  workorders: "أوامر العمل والفحص",
  inventory: "المخزون",
  accounting: "المحاسبة والتقارير المالية",
  hr: "الموارد البشرية",
};

const FORMAT_COLORS: Record<ExportItem["format"], string> = {
  pdf: "bg-destructive/10 text-destructive border-destructive/30",
  excel: "bg-success/10 text-success border-success/30",
  csv: "bg-info/10 text-info border-info/30",
  report: "bg-primary/10 text-primary border-primary/30",
};

const FORMAT_LABELS: Record<ExportItem["format"], string> = {
  pdf: "PDF",
  excel: "Excel",
  csv: "CSV",
  report: "تقرير",
};

export default function ReportsCenter() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<"all" | ExportItem["group"]>("all");

  const filtered = useMemo(() => {
    return ITEMS.filter((it) => {
      if (activeGroup !== "all" && it.group !== activeGroup) return false;
      if (search) {
        const q = search.toLowerCase();
        return `${it.title} ${it.description}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [search, activeGroup]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: ITEMS.length };
    ITEMS.forEach((i) => { out[i.group] = (out[i.group] || 0) + 1; });
    return out;
  }, []);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileBarChart className="text-primary" size={26} /> مركز التقارير والمستخرجات
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            كل التقارير و PDF و Excel من كل وحدات النظام في مكان واحد
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => smartBack(navigate, "/reports")} className="gap-1">
            <FileBarChart size={14} /> التقارير الكاملة
          </Button>
          <Button variant="outline" onClick={() => navigate(-1)} className="gap-1">
            <ArrowRight size={14} /> رجوع
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/30">
          <p className="text-xs text-muted-foreground">إجمالي المستخرجات</p>
          <p className="text-2xl font-bold text-primary">{ITEMS.length}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/30">
          <p className="text-xs text-muted-foreground">PDF</p>
          <p className="text-2xl font-bold text-destructive">{ITEMS.filter((i) => i.format === "pdf").length}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-success/10 to-success/5 border-success/30">
          <p className="text-xs text-muted-foreground">Excel</p>
          <p className="text-2xl font-bold text-success">{ITEMS.filter((i) => i.format === "excel").length}</p>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-info/10 to-info/5 border-info/30">
          <p className="text-xs text-muted-foreground">تقارير تفاعلية</p>
          <p className="text-2xl font-bold text-info">{ITEMS.filter((i) => i.format === "report").length}</p>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input
          placeholder="ابحث عن تقرير أو مستخرج..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9"
        />
      </div>

      {/* Group tabs */}
      <Tabs value={activeGroup} onValueChange={(v) => setActiveGroup(v as any)} dir="rtl">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="all">الكل ({counts.all})</TabsTrigger>
          {Object.entries(GROUP_LABELS).map(([k, l]) => counts[k] ? (
            <TabsTrigger key={k} value={k}>{l} ({counts[k]})</TabsTrigger>
          ) : null)}
        </TabsList>

        <TabsContent value={activeGroup} className="mt-4">
          {filtered.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">
              لا توجد مستخرجات مطابقة للبحث
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((item) => {
                const Icon = item.icon;
                return (
                  <Card
                    key={item.key}
                    className="p-4 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
                    onClick={() => navigate(item.route)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${FORMAT_COLORS[item.format]} border`}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="font-semibold text-sm leading-tight group-hover:text-primary transition-colors">
                            {item.title}
                          </h3>
                          {item.badge && (
                            <Badge variant="secondary" className="text-[10px] shrink-0">{item.badge}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                          {item.description}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${FORMAT_COLORS[item.format]}`}>
                            {FORMAT_LABELS[item.format]}
                          </span>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Download size={10} /> فتح المصدر
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
