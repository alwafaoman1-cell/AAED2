import { useNavigate, useParams } from "react-router-dom";
import { smartBack } from "@/lib/smartBack";
import { ArrowLeft, Plus, Edit, Trash2, Copy, Check, Eye, Star, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getDocTypeMeta } from "@/lib/printTemplates/registry";
import { usePrintTemplates, useTemplateMutations, type PrintTemplate } from "@/hooks/usePrintTemplates";
import { defaultSchemaFor } from "@/lib/printTemplates/defaults";
import type { DocType } from "@/lib/printTemplates/schema";
import { useState, useEffect, useRef } from "react";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { renderTemplate } from "@/lib/printTemplates/renderer";
import { sampleDataFor } from "@/lib/printTemplates/sampleData";

export default function PrintTemplateVariants() {
  const { docType } = useParams<{ docType: DocType }>();
  const navigate = useNavigate();
  const meta = getDocTypeMeta(docType as DocType);
  const Icon = meta.icon;

  const { templates, isLoading, defaultFor } = usePrintTemplates(docType as DocType);
  const { create, remove, setDefault, duplicate } = useTemplateMutations();
  const [deleting, setDeleting] = useState<PrintTemplate | null>(null);
  const [previewing, setPreviewing] = useState<PrintTemplate | null>(null);
  const seededRef = useRef(false);

  const hasDefault = !!defaultFor(docType as DocType);

  // Auto-seed: create a default system template the first time this doc type is opened
  useEffect(() => {
    if (isLoading || !docType || seededRef.current) return;
    if (templates.length === 0) {
      seededRef.current = true;
      create.mutateAsync({
        doc_type: docType as DocType,
        name: `قالب ${meta.nameAr} الافتراضي`,
        description: "تم إنشاؤه تلقائياً — يمكنك تعديله أو حذفه",
        schema: defaultSchemaFor(docType as DocType),
        is_default: true,
      }).catch(() => { seededRef.current = false; });
    }
  }, [isLoading, templates.length, docType]);

  const handleNew = async (fromSystem = true) => {
    const schema = fromSystem ? defaultSchemaFor(docType as DocType) : { version: 1 as const, page: defaultSchemaFor(docType as DocType).page, blocks: [] };
    try {
      const created = await create.mutateAsync({
        doc_type: docType as DocType,
        name: fromSystem ? `قالب ${meta.nameAr} الكلاسيكي` : `قالب ${meta.nameAr} جديد`,
        description: fromSystem ? "مبني على القالب الافتراضي" : "قالب فارغ",
        schema,
        is_default: !hasDefault,
      });
      toast.success("تم إنشاء القالب");
      navigate(`/settings/print-templates/${docType}/edit/${created.id}`);
    } catch (e: any) {
      toast.error(e?.message || "فشل الإنشاء");
    }
  };

  const handleSetDefault = async (t: PrintTemplate) => {
    try {
      await setDefault.mutateAsync(t.id);
      toast.success(`تم تعيين "${t.name}" كقالب افتراضي`);
    } catch (e: any) {
      toast.error(e?.message || "فشل التعيين");
    }
  };

  const handleDuplicate = async (t: PrintTemplate) => {
    try {
      const dup = await duplicate.mutateAsync(t);
      toast.success("تم تكرار القالب");
      navigate(`/settings/print-templates/${docType}/edit/${dup.id}`);
    } catch (e: any) {
      toast.error(e?.message || "فشل التكرار");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success("تم حذف القالب");
      setDeleting(null);
    } catch (e: any) {
      toast.error(e?.message || "فشل الحذف");
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings/print-templates")}>
              <ArrowLeft className="rtl:rotate-180" />
            </Button>
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${meta.color}18`, color: meta.color }}>
                <Icon size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{meta.nameAr}</h1>
                <div className="text-xs text-muted-foreground mt-0.5" dir="ltr" style={{ textAlign: "left" }}>{meta.nameEn}</div>
                <p className="text-sm text-muted-foreground mt-1.5">{meta.description}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleNew(false)} disabled={create.isPending}>
              <Plus size={16} /> فارغ
            </Button>
            <Button onClick={() => handleNew(true)} disabled={create.isPending} style={{ background: meta.color, color: "#fff" }}>
              <Sparkles size={16} /> قالب جديد
            </Button>
          </div>
        </div>

        {/* Templates grid */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">جاري التحميل...</div>
        ) : templates.length === 0 ? (
          <EmptyState onCreate={() => handleNew(true)} color={meta.color} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                color={meta.color}
                onEdit={() => navigate(`/settings/print-templates/${docType}/edit/${t.id}`)}
                onPreview={() => setPreviewing(t)}
                onSetDefault={() => handleSetDefault(t)}
                onDuplicate={() => handleDuplicate(t)}
                onDelete={() => setDeleting(t)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف القالب "${deleting?.name || ""}"`}
        description="سيتم حذف القالب نهائياً. لا يمكن التراجع عن هذا الإجراء."
        confirmLabel="حذف نهائي"
      />

      {previewing && (
        <PdfPreviewDialog
          open={!!previewing}
          onOpenChange={(o) => !o && setPreviewing(null)}
          htmlContent={renderTemplate(previewing.schema, sampleDataFor(previewing.doc_type), previewing.name)}
          title={`معاينة: ${previewing.name}`}
          fileName={`Preview-${previewing.name}`}
        />
      )}
    </div>
  );
}

function TemplateCard({ template, color, onEdit, onPreview, onSetDefault, onDuplicate, onDelete }: any) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden group hover:border-primary/40 transition">
      {/* Thumbnail / Preview */}
      <div
        className="relative h-44 bg-gradient-to-br from-muted/40 to-muted/10 border-b border-border overflow-hidden cursor-pointer"
        onClick={onPreview}
        style={{ borderTop: `3px solid ${color}` }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-32 h-40 bg-white shadow-md rounded-sm flex flex-col items-center justify-center gap-1.5 transform rotate-[-2deg] group-hover:rotate-0 transition">
            <div className="w-20 h-2 bg-gray-300 rounded"></div>
            <div className="w-24 h-1.5 bg-gray-200 rounded"></div>
            <div className="w-24 h-1.5 bg-gray-200 rounded"></div>
            <div className="w-24 h-1.5 bg-gray-200 rounded"></div>
            <div className="w-16 h-3 mt-2 rounded" style={{ background: color, opacity: 0.4 }}></div>
          </div>
        </div>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="bg-white/95 text-foreground px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5">
            <Eye size={12} /> معاينة
          </div>
        </div>
        {template.is_default && (
          <Badge className="absolute top-2 right-2 bg-emerald-500 text-white text-[10px] gap-1">
            <Check size={10} /> نشط
          </Badge>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-bold text-sm text-foreground line-clamp-1">{template.name}</h3>
        {template.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1 leading-relaxed">{template.description}</p>
        )}
        <div className="text-[10px] text-muted-foreground/70 mt-2">
          عدد العناصر: <span className="font-mono">{template.schema?.blocks?.length ?? 0}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border/50">
          <Button size="sm" variant="default" className="flex-1 gap-1 h-8 text-xs" onClick={onEdit}>
            <Edit size={12} /> تعديل
          </Button>
          {!template.is_default && (
            <Button size="sm" variant="outline" className="h-8 px-2" onClick={onSetDefault} title="تعيين كافتراضي">
              <Star size={12} />
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 px-2" onClick={onDuplicate} title="تكرار">
            <Copy size={12} />
          </Button>
          {!template.is_system && (
            <Button size="sm" variant="outline" className="h-8 px-2 text-destructive hover:bg-destructive/10" onClick={onDelete} title="حذف">
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate, color }: { onCreate: () => void; color: string }) {
  return (
    <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center">
      <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: `${color}18`, color }}>
        <Plus size={28} />
      </div>
      <h3 className="text-lg font-bold mb-2">لا توجد قوالب مخصصة بعد</h3>
      <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
        ابدأ بإنشاء قالب من النموذج الافتراضي ثم خصّصه بالسحب والإفلات.
      </p>
      <Button onClick={onCreate} style={{ background: color, color: "#fff" }}>
        <Sparkles size={16} /> إنشاء قالب جديد
      </Button>
    </div>
  );
}
