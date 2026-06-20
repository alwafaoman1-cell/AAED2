import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";

export default function SalesSettings() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";

  return (
    <div className="space-y-4 max-w-3xl" dir={isRtl ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-bold border-b pb-3">{isAr ? "إعدادات المبيعات" : "Sales Settings"}</h1>
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-semibold mb-1">{isAr ? "ترقيم المستندات" : "Document numbering"}</h3>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? "يتم ترقيم الفواتير تلقائيًا بصيغة INV-00001، عروض الأسعار QT-00001، إشعارات دائنة CN-00001، الفواتير المرتجعة RET-00001، الفواتير الدورية REC-00001."
              : "Documents are numbered automatically: INV-00001 invoices, QT-00001 quotes, CN-00001 credit notes, RET-00001 returns, REC-00001 recurring."}
          </p>
        </div>
        <div>
          <h3 className="font-semibold mb-1">{isAr ? "العملة الافتراضية" : "Default currency"}</h3>
          <p className="text-sm text-muted-foreground">OMR ر.ع — {isAr ? "ضريبة افتراضية 5%" : "Default VAT 5%"}</p>
        </div>
        <div>
          <h3 className="font-semibold mb-1">{isAr ? "قوالب الطباعة" : "Print templates"}</h3>
          <p className="text-sm text-muted-foreground">
            {isAr ? "اذهب إلى الإعدادات → قوالب الطباعة لتعديل قالب الفاتورة." : "Go to Settings → Print Templates to edit invoice template."}
          </p>
        </div>
      </Card>
    </div>
  );
}
