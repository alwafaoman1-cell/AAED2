import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export interface UplItem {
  description: string;
  quantity: number;
  unit_price: number;
}

interface Props {
  items: UplItem[];
  onChange: (items: UplItem[]) => void;
  readOnly?: boolean;
}

export default function UplItemsEditor({ items, onChange, readOnly }: Props) {
  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);

  const update = (i: number, patch: Partial<UplItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, { description: "", quantity: 1, unit_price: 0 }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <Card className="p-4 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-base">بنود التقدير (UPL)</Label>
          <p className="text-xs text-muted-foreground mt-0.5">قائمة الأسعار الموحدة — كل بند بكمية وسعر وحدة</p>
        </div>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="h-4 w-4 ml-1" /> إضافة بند
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">لم تتم إضافة بنود — اضغط "إضافة بند" للبدء</p>
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
                  placeholder="مثل: استبدال صدام أمامي"
                  disabled={readOnly}
                />
                <Input
                  className="col-span-2 text-center"
                  type="number" min="0" step="1"
                  value={it.quantity}
                  onChange={(e) => update(i, { quantity: parseFloat(e.target.value) || 0 })}
                  disabled={readOnly}
                />
                <Input
                  className="col-span-2 text-center"
                  type="number" min="0" step="0.01"
                  value={it.unit_price}
                  onChange={(e) => update(i, { unit_price: parseFloat(e.target.value) || 0 })}
                  disabled={readOnly}
                />
                <div className="col-span-1 text-center font-semibold text-sm">
                  {lineTotal.toFixed(2)}
                </div>
                {!readOnly && (
                  <Button
                    size="icon" variant="ghost"
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
              إجمالي البنود: <span className="font-bold text-base">{total.toFixed(2)} ر.ع</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
