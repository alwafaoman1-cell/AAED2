import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";
import { toast } from "sonner";
import { DEFAULT_UPL_ITEMS, type UplItem } from "@/components/insurance/uplItems";
import i18n from "@/i18n";

const ar = {
  title: "بنود التقدير (UPL)",
  description: "قائمة الأسعار الموحدة — كل بند بكمية وسعر وحدة. البنود الأساسية: قطع الغيار وأجرة العمالة.",
  defaults: "قطع الغيار + أجرة العمالة",
  fillParts: "تعبئة السعر في قطع الغيار",
  fillLabor: "تعبئة السعر في أجرة العمالة",
  add: "إضافة بند",
  bulkTitle: "إضافة بنود متعددة دفعة واحدة",
  bulkHelp: "الصق كل قطعة أو بند في سطر مستقل. سيُدرج كل سطر كبند UPL مستقل بكمية 1 وسعر فارغ للتعبئة اليدوية.",
  bulkPlaceholder: "متجار أمامي يمين\nبنفر أمامي كامل\nلايت أمامي يمين\nشبك كروم أمامي",
  bulkPreservation: "لا تُحذف البنود الموجودة، وتُتجاهل الأسطر الفارغة والبنود المكررة داخل نفس المطالبة.",
  bulkAdd: "إضافة القائمة إلى البنود",
  bulkEmpty: "الصق قائمة البنود أولًا، كل بند في سطر مستقل",
  bulkDuplicate: "لم تتم إضافة أي بند: كل البنود موجودة مسبقًا أو مكررة",
  bulkSuccess: "تمت إضافة {{count}} بند إلى تقدير UPL. أدخل الأسعار يدويًا ثم احفظ المطالبة.",
  empty: "اضغط «قطع الغيار + أجرة العمالة» لإضافة البنود الافتراضية، أو اختر تعبئة السعر في البند المناسب.",
  emptyReadOnly: "لا توجد بنود تقدير.",
  itemNumber: "البند {{number}}",
  itemDescription: "الوصف",
  itemPlaceholder: "مثال: قطع الغيار",
  quantity: "الكمية",
  unitPrice: "سعر الوحدة (ر.ع.)",
  lineTotal: "إجمالي البند",
  remove: "حذف البند {{number}}",
  total: "إجمالي البنود",
  currency: "ر.ع.",
};

const en: typeof ar = {
  title: "Estimate items (UPL)",
  description: "Unified price list: each item has a quantity and unit price. The standard items are spare parts and labour charges.",
  defaults: "Spare parts + labour charges",
  fillParts: "Apply suggested price to parts",
  fillLabor: "Apply suggested price to labour",
  add: "Add item",
  bulkTitle: "Add multiple items",
  bulkHelp: "Paste one part or item per line. Each line becomes a separate UPL item with quantity 1 and a blank price to enter manually.",
  bulkPlaceholder: "Front right fender\nComplete front bumper\nFront right headlight\nFront chrome grille",
  bulkPreservation: "Existing items are retained. Blank lines and duplicate items within this claim are ignored.",
  bulkAdd: "Add list to items",
  bulkEmpty: "Paste the items first, with one item per line",
  bulkDuplicate: "No items were added: all items already exist or are duplicated",
  bulkSuccess: "Added {{count}} items to the UPL estimate. Enter prices manually, then save the claim.",
  empty: "Choose “Spare parts + labour charges” to add the standard items, or apply the suggested price to the appropriate item.",
  emptyReadOnly: "No estimate items.",
  itemNumber: "Item {{number}}",
  itemDescription: "Description",
  itemPlaceholder: "For example: spare parts",
  quantity: "Quantity",
  unitPrice: "Unit price (OMR)",
  lineTotal: "Item total",
  remove: "Remove item {{number}}",
  total: "Items total",
  currency: "OMR",
};

for (const [language, resources] of [["ar", ar], ["en", en]] as const) {
  i18n.addResourceBundle(language, "uplItemsEditor", resources, true, false);
}

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
  const { t, i18n } = useTranslation("uplItemsEditor");
  const editorId = useId();
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
      toast.error(t("bulkEmpty"));
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
      toast.error(t("bulkDuplicate"));
      return;
    }

    onChange([...items, ...additions]);
    setBulkItemsText("");
    toast.success(t("bulkSuccess", { count: additions.length }));
  }

  return (
    <Card role="region" aria-labelledby={`${editorId}-title`} dir={i18n.dir()} className="min-w-0 space-y-4 bg-muted/30 p-3 sm:p-4">
      <div className="min-w-0 space-y-3">
        <div className="min-w-0">
          <h3 id={`${editorId}-title`} className="break-words text-base font-semibold">{t("title")}</h3>
          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{t("description")}</p>
        </div>
        {!readOnly && (
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.length === 0 && (
              <Button type="button" variant="secondary" onClick={addDefaults} className="h-auto min-h-11 min-w-0 whitespace-normal px-3 py-2 text-center leading-5">
                {t("defaults")}
              </Button>
            )}
            {suggestedAmount > 0 && (
              <>
                <Button type="button" variant="outline" onClick={() => fillSuggested("parts")} className="h-auto min-h-11 min-w-0 whitespace-normal px-3 py-2 text-center leading-5">
                  {t("fillParts")}
                </Button>
                <Button type="button" variant="outline" onClick={() => fillSuggested("labor")} className="h-auto min-h-11 min-w-0 whitespace-normal px-3 py-2 text-center leading-5">
                  {t("fillLabor")}
                </Button>
              </>
            )}
            <Button type="button" variant="outline" onClick={add} className="h-auto min-h-11 min-w-0 whitespace-normal px-3 py-2 leading-5">
              <Plus aria-hidden="true" className="h-4 w-4 shrink-0" /> {t("add")}
            </Button>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="min-w-0 space-y-3 rounded-lg border border-dashed border-primary/30 bg-background/70 p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${editorId}-bulk`} className="text-sm leading-5">{t("bulkTitle")}</Label>
            <p id={`${editorId}-bulk-help`} className="break-words text-xs leading-5 text-muted-foreground">{t("bulkHelp")}</p>
          </div>
          <Textarea
            id={`${editorId}-bulk`}
            aria-describedby={`${editorId}-bulk-help ${editorId}-bulk-preservation`}
            value={bulkItemsText}
            onChange={(e) => setBulkItemsText(e.target.value)}
            placeholder={t("bulkPlaceholder")}
            className="min-h-24 min-w-0 resize-y bg-background text-base md:text-sm"
          />
          <div className="flex min-w-0 flex-col gap-3 sm:items-start">
            <p id={`${editorId}-bulk-preservation`} className="break-words text-xs leading-5 text-muted-foreground">{t("bulkPreservation")}</p>
            <Button
              type="button"
              variant="outline"
              onClick={addBulkItems}
              disabled={!bulkItemsText.trim()}
              className="h-auto min-h-11 min-w-0 gap-1 whitespace-normal px-3 py-2 leading-5"
            >
              <Plus aria-hidden="true" className="h-4 w-4 shrink-0" /> {t("bulkAdd")}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <p className="break-words py-4 text-center text-sm leading-6 text-muted-foreground">
          {t(readOnly ? "emptyReadOnly" : "empty")}
        </p>
      ) : (
        <div className="min-w-0 space-y-3">
          {items.map((it, i) => {
            const lineTotal = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
            return (
              <fieldset key={i} className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-border bg-background/70 p-3 sm:grid-cols-2">
                <legend className="px-1 text-xs font-semibold text-muted-foreground">{t("itemNumber", { number: i + 1 })}</legend>
                <div className="min-w-0 space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`${editorId}-description-${i}`} className="text-xs">{t("itemDescription")}</Label>
                  <Textarea
                    id={`${editorId}-description-${i}`}
                    className="min-h-20 min-w-0 resize-y text-base md:text-sm"
                    rows={2}
                    value={it.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder={t("itemPlaceholder")}
                    disabled={readOnly}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`${editorId}-quantity-${i}`} className="text-xs">{t("quantity")}</Label>
                  <Input
                    id={`${editorId}-quantity-${i}`}
                    className="min-h-11 min-w-0 text-left tabular-nums"
                    dir="ltr"
                    type="text"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={it.quantity}
                    onChange={(e) => update(i, { quantity: parseMoneyInput(e.target.value) })}
                    disabled={readOnly}
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor={`${editorId}-price-${i}`} className="text-xs">{t("unitPrice")}</Label>
                  <Input
                    id={`${editorId}-price-${i}`}
                    className="min-h-11 min-w-0 text-left tabular-nums"
                    dir="ltr"
                    type="text"
                    inputMode="decimal"
                    min="0"
                    step="0.001"
                    value={it.unit_price}
                    onChange={(e) => update(i, { unit_price: parseMoneyInput(e.target.value) })}
                    disabled={readOnly}
                  />
                </div>
                <div className="flex min-w-0 items-end justify-between gap-3 border-t pt-3 sm:col-span-2">
                  <div className="min-w-0 space-y-1">
                    <div id={`${editorId}-line-total-${i}`} className="text-xs text-muted-foreground">{t("lineTotal")}</div>
                    <output aria-labelledby={`${editorId}-line-total-${i}`} data-amount="true" className="block break-all text-left text-sm font-semibold tabular-nums" dir="ltr">
                      {lineTotal.toFixed(3)} {t("currency")}
                    </output>
                  </div>
                  {!readOnly && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-11 w-11 shrink-0 text-destructive"
                      aria-label={t("remove", { number: i + 1 })}
                      onClick={() => remove(i)}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </fieldset>
            );
          })}
          <div className="flex min-w-0 flex-col gap-1 border-t pt-3 sm:items-end">
            <div id={`${editorId}-total`} className="text-sm font-medium">{t("total")}</div>
            <output aria-labelledby={`${editorId}-total`} data-amount="true" className="block max-w-full break-all text-left text-lg font-bold tabular-nums" dir="ltr">
              {total.toFixed(3)} {t("currency")}
            </output>
          </div>
        </div>
      )}
    </Card>
  );
}
