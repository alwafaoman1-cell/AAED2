// Reusable template picker for any DocType
// Lists active tenant templates of a given doc_type and allows the user to
// pick which one to use right now. The picker mutates the cached "is_default"
// flag (via the Supabase row), and renderer/resolver picks it up automatically.
import { useEffect, useState } from "react";
import { Check, FileText, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { usePrintTemplates, useTemplateMutations } from "@/hooks/usePrintTemplates";
import type { DocType } from "@/lib/printTemplates/schema";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface Props {
  docType: DocType;
  /** Triggered after a successful change so the consumer can re-render its preview. */
  onChange?: (templateId: string | null) => void;
  size?: "sm" | "md";
  className?: string;
}

export default function TemplatePicker({ docType, onChange, size = "md", className }: Props) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const { templates, isLoading } = usePrintTemplates(docType);
  const { setDefault, clearDefault } = useTemplateMutations();
  const [open, setOpen] = useState(false);

  const active = templates.find((t) => t.is_default) || null;
  const label = active ? active.name : isAr ? "قالب النظام (الثيم الحالي)" : "System default (current theme)";

  async function pick(id: string) {
    try {
      await setDefault.mutateAsync(id);
      toast.success(isAr ? "تم تطبيق القالب" : "Template applied");
      setOpen(false);
      onChange?.(id);
    } catch (e: any) {
      toast.error(e?.message || (isAr ? "تعذّر تغيير القالب" : "Failed"));
    }
  }

  async function resetToSystem() {
    try {
      await clearDefault.mutateAsync(docType);
      toast.success(isAr ? "تم الرجوع لقالب الثيم الافتراضي" : "Reverted to system theme template");
      setOpen(false);
      onChange?.(null);
    } catch (e: any) {
      toast.error(e?.message || (isAr ? "تعذّر الإرجاع" : "Failed"));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size === "sm" ? "sm" : "default"}
          className={`gap-2 ${className || ""}`}
        >
          <FileText className="h-4 w-4" />
          <span className="truncate max-w-[160px]">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <div className="px-2 py-1.5 text-[11px] text-muted-foreground border-b">
          {isAr ? "اختر القالب لهذا المستند" : "Pick template for this document"}
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            {isAr ? "لا توجد قوالب — أنشئ من إعدادات قوالب الطباعة" : "No templates — create one in Print Templates"}
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <button
              onClick={resetToSystem}
              disabled={clearDefault.isPending || !active}
              className={`w-full text-start px-3 py-2 text-sm rounded hover:bg-muted flex items-center justify-between gap-2 border-b ${
                !active ? "bg-primary/10" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                  {isAr ? "قالب النظام (الثيم الحالي)" : "System default (current theme)"}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {isAr ? "إرجاع القالب إلى التصميم المدمج في النظام" : "Revert to the built-in themed template"}
                </div>
              </div>
              {!active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
            </button>
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                disabled={setDefault.isPending}
                className={`w-full text-start px-3 py-2 text-sm rounded hover:bg-muted flex items-center justify-between gap-2 ${
                  t.is_default ? "bg-primary/10" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{t.name}</div>
                  {t.description && (
                    <div className="text-[10px] text-muted-foreground truncate">{t.description}</div>
                  )}
                </div>
                {t.is_default && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
