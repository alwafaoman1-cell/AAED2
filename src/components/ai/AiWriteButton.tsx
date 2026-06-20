import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Wand2, FileText, Languages } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Mode = "generate" | "improve" | "summarize" | "translate";

interface Props {
  value: string;
  onChange: (next: string) => void;
  context?: string; // optional context (e.g., car, customer, claim)
  placeholder?: string;
  language?: "ar" | "en";
  size?: "sm" | "icon" | "default";
  className?: string;
  label?: string;
}

/**
 * زر مساعد كتابة بالذكاء الاصطناعي قابل لإلحاقه بأي حقل ملاحظات/تعليقات.
 * يدعم: توليد جديد، تحسين النص الحالي، تلخيص، ترجمة.
 */
export default function AiWriteButton({
  value, onChange, context, placeholder = "اكتب فكرة الملاحظة...",
  language = "ar", size = "sm", className, label = "كتابة بالذكاء",
}: Props) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState<Mode | null>(null);

  async function run(mode: Mode) {
    setLoading(mode);
    try {
      const { data, error } = await supabase.functions.invoke("ai-write-note", {
        body: { mode, instruction, currentText: value, context, language },
      });
      if (error) throw error;
      const text = (data as any)?.text?.trim();
      if (!text) throw new Error("لم يتم توليد نص");
      // For generate → append if there's existing text; otherwise replace.
      if (mode === "generate" && value?.trim()) {
        onChange(`${value.trim()}\n${text}`);
      } else {
        onChange(text);
      }
      setOpen(false);
      setInstruction("");
      toast.success("تم التوليد");
    } catch (e: any) {
      toast.error(e?.message ?? "فشل التوليد");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          className={className}
          title={label}
        >
          <Sparkles className="h-4 w-4" />
          {size !== "icon" && <span className="ms-1">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" dir="rtl">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium mb-1.5">مساعد الكتابة الذكي</p>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={placeholder}
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button" size="sm" variant="default"
              onClick={() => run("generate")}
              disabled={loading !== null || (!instruction.trim() && !value?.trim())}
            >
              {loading === "generate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="ms-1">توليد</span>
            </Button>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => run("improve")}
              disabled={loading !== null || !value?.trim()}
            >
              {loading === "improve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              <span className="ms-1">تحسين</span>
            </Button>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => run("summarize")}
              disabled={loading !== null || !value?.trim()}
            >
              {loading === "summarize" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              <span className="ms-1">تلخيص</span>
            </Button>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => run("translate")}
              disabled={loading !== null || !value?.trim()}
            >
              {loading === "translate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
              <span className="ms-1">ترجمة</span>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            يستخدم Lovable AI أو مفتاح OpenAI/Gemini من الإعدادات.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
