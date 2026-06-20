import { useNavigate } from "react-router-dom";
import { smartBack } from "@/lib/smartBack";
import { ArrowLeft, FileBarChart, Plus, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DOC_TYPES, CATEGORY_LABELS } from "@/lib/printTemplates/registry";
import { usePrintTemplates } from "@/hooks/usePrintTemplates";

export default function PrintTemplates() {
  const navigate = useNavigate();
  const { countByType, defaultFor, isLoading } = usePrintTemplates();

  const grouped = DOC_TYPES.reduce((acc, dt) => {
    (acc[dt.category] ||= []).push(dt);
    return acc;
  }, {} as Record<string, typeof DOC_TYPES>);

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings")}>
              <ArrowLeft className="rtl:rotate-180" />
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <FileBarChart className="text-primary" />
                قوالب الطباعة
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                صمّم قوالب احترافية لكل نوع من المستخرجات. يتم تطبيق التعديلات فوراً على كل الموقع.
              </p>
            </div>
          </div>
        </div>

        {/* Categories */}
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat} className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {CATEGORY_LABELS[cat]?.ar} <span className="opacity-50">/ {CATEGORY_LABELS[cat]?.en}</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {list.map((dt) => {
                const Icon = dt.icon;
                const count = countByType(dt.type);
                const def = defaultFor(dt.type);
                return (
                  <button
                    key={dt.type}
                    onClick={() => navigate(`/settings/print-templates/${dt.type}`)}
                    className="group relative bg-card border border-border rounded-xl p-5 text-right transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{ background: `${dt.color}18`, color: dt.color }}
                      >
                        <Icon size={22} />
                      </div>
                      <Badge variant={count > 0 ? "default" : "secondary"} className="text-[10px]">
                        {count > 0 ? `${count} قالب` : "نظام افتراضي"}
                      </Badge>
                    </div>
                    <h3 className="font-bold text-foreground mb-1">{dt.nameAr}</h3>
                    <div className="text-[11px] text-muted-foreground/70 mb-2 ltr-text" dir="ltr" style={{ textAlign: "left" }}>
                      {dt.nameEn}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{dt.description}</p>

                    {def && (
                      <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span className="text-muted-foreground">القالب النشط:</span>
                        <span className="font-semibold text-foreground truncate">{def.name}</span>
                      </div>
                    )}

                    <div className="absolute inset-x-5 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-primary font-semibold gap-1">
                      <Eye size={12} /> إدارة القوالب →
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {isLoading && <div className="text-center text-muted-foreground py-8">جاري التحميل...</div>}
      </div>
    </div>
  );
}
