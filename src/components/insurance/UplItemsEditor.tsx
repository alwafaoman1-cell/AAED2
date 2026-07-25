import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";
import { toast } from "sonner";

export interface UplItem {
  description: string;
  quantity: number;
  unit_price: number;
}

export const DEFAULT_UPL_ITEMS: UplItem[] = [
  { description: "قطع الغيار / Spare Parts", quantity: 1, unit_price: 0 },
  { description: "أجرة العمالة / Labour Charges", quantity: 1, unit_price: 0 },
];

interface Props {
  items: UplItem[];
  onChange: (items: UplItem[]) => void;
  readOnly?: boolean;
  suggestedAmount?: number;
}

function normalizeUplItemNameForMatch(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/^\s*(?:[-*•]+|\d+[.)-])\s*/, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function cleanBulkUplLine(value: string): string {
  return value
    .trim()
    .replace(/^\s*(?:[-*•]+|\d+[.)-])\s*/, "")
    .replace(/\s+/g, " ");
}

export default function UplItemsEditor({ items, onChange, readOnly, suggestedAmount = 0 }: Props) {
  const [bulkItemsText, setBulkItemsText] = useState("");
  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

  const update = (i: number, patch: Partial<UplItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, { description: "", quantity: 1, unit_price: 0 }]);
  const addDefaults = () => onChange(DEFAULT_UPL_ITEMS.map((it) => ({ ...it })));
  const fillSuggested = (target: "parts" | "labor") =>
    onChange(DEFAULT_UPL_ITEMS.map((it, idx) => ({
      ...it,
      unit_price: target === "parts" ? (idx === 0 ? suggestedAmount : 0) : (idx === 1 ? suggestedAmount : 0),
    })));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  function addBulkItems() {
    const lines = bulkItemsText
      .split(/\r?\n/)
      .map(cleanBulkUplLine)
      .filter(Boolean);

    if (!lines.length) {
      toast.error("الصق قائمة البنود أولًا، كل بند في سطر مستقل");
      return;
    }

    const existingKeys = new Set(items.map((item) => normalizeUplItemNameForMatch(item.description)).filter(Boolean));
    const seenKeys = new Set<string>();
    const additions: UplItem[] = [];

    for (const description of lines) {
      const key = normalizeUplItemNameForMatch(description);
      if (!key || existingKeys.has(key) || seenKeys.has(key)) continue;
      seenKeys.add(key);
      additions.push({
        description,
        quantity: 1,
        unit_price: "" as unknown as number,
      });
    }

    if (!additions.length) {
      toast.error("لم تتم إضافة أي بند: كل البنود موجودة مسبقًا أو مكررة");
      return;
    }

    onChange([...items, ...additions]);
    setBulkItemsText("");
    toast.success(`تمت إضافة ${additions.length} بند إلى تقدير UPL. أدخل الأسعار يدويًا ثم احفظ المطالبة.`);
  }

  return (
    <Card className="p-4 space-y-3 bg-muted/30">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Label className="text-base">بنود التقدير (UPL)</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            قائمة الأسعار الموحدة — كل بند بكمية وسعر وحدة. البنود الأساسية: قطع الغيار وأجرة العمالة.
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2 justify-end">
            {items.length === 0 && (
              <Button type="button" size="sm" variant="secondary" onClick={addDefaults}>
                قطع الغيار + أجرة العمالة
              </Button>
            )}
            {suggestedAmount > 0 && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => fillSuggested("parts")}>
                  تعبئة السعر في قطع الغيار
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => fillSuggested("labor")}>
                  تعبئة السعر في أجرة العمالة
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="outline" onClick={add}>
              <Plus className="h-4 w-4 ml-1" /> إضافة بند
            </Button>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="rounded-lg border border-dashed border-primary/30 bg-background/70 p-3 space-y-2">
          <div className="flex flex-col gap-1">
            <Label className="text-sm">إضافة بنود متعددة دفعة واحدة</Label>
            <p className="text-xs text-muted-foreground">
              الصق كل قطعة أو بند في سطر مستقل. سيتم إدراج كل سطر كبند UPL مستقل بكمية 1 وسعر فارغ للتعبئة اليدوية.
            </p>
          </div>
          <Textarea
            value={bulkItemsText}
            onChange={(e) => setBulkItemsText(e.target.value)}
            placeholder={"متجار أمامي يمين\nبنفر أمامي كامل\nلايت أمامي يمين\nشبك كروم أمامي"}
            className="min-h-24 bg-background text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              لا يتم حذف البنود الموجودة، ويتم تجاهل الأسطر الفارغة والبنود المكررة داخل نفس المطالبة.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addBulkItems}
              disabled={!bulkItemsText.trim()}
              className="gap-1"
            >
              <Plus className="h-4 w-4" /> إضافة القائمة إلى البنود
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          اضغط “قطع الغيار + أجرة العمالة” لإضافة البنود الافتراضية، أو اختر تعبئة السعر في البند المناسب.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2">
            <div className="col-span-6">الوصف</div>
            <div className="col-span-2 text-center">الكمية</div>
            <div className="col-span-2 text-center">سعر الوحدة</div>
            <div className="col-span-1 text-center">الإجمالي</div>
            <div className="col-span-1"></div>
          </div>
          {items.map((it, i) => {
            const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
            return (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-6"
                  value={it.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  placeholder="مثال: قطع الغيار / Spare Parts"
                  disabled={readOnly}
                />
                <Input
                  className="col-span-2 text-center"
                  type="text"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={it.quantity}
                  onChange={(e) => update(i, { quantity: parseMoneyInput(e.target.value) })}
                  disabled={readOnly}
                />
                <Input
                  className="col-span-2 text-center"
                  type="text"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  value={it.unit_price}
                  onChange={(e) => update(i, { unit_price: parseMoneyInput(e.target.value) })}
                  disabled={readOnly}
                />
                <div className="col-span-1 text-center font-semibold text-sm" dir="ltr">
                  {lineTotal.toFixed(3)}
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="col-span-1 h-8 w-8 text-destructive"
                    onClick={() => remove(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
          <div className="flex justify-end pt-2 border-t">
            <div className="text-sm">
              إجمالي البنود: <span className="font-bold text-base" dir="ltr">{total.toFixed(3)} ر.ع</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
