import { useEffect, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Save, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { employeeCashboxesStore } from "@/lib/financeSettingsStore";

export default function CashboxTopup() {
  const navigate = useNavigate();
  const [, force] = useState(0);
  useEffect(() => {
    const u = employeeCashboxesStore.subscribe(() => force((n) => n + 1));
    return () => { u(); };
  }, []);

  const cashboxes = employeeCashboxesStore.getAll().filter((c) => c.active);

  const [cashboxId, setCashboxId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const handleSave = () => {
    const value = parseFloat(amount);
    if (!cashboxId) return toast.error("اختر الخزينة");
    if (!value || value <= 0) return toast.error("أدخل مبلغاً صحيحاً");

    const cb = cashboxes.find((c) => c.id === cashboxId);
    if (!cb) return;
    employeeCashboxesStore.update(cb.id, { currentBalance: cb.currentBalance + value });
    toast.success(`تمت إضافة ${value.toLocaleString()} ر.ع إلى ${cb.cashboxName}`);
    navigate("/accounting");
  };

  const selectedCb = cashboxes.find((c) => c.id === cashboxId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="text-primary" size={24} /> إضافة رصيد خزينة
          </h1>
          <p className="text-sm text-muted-foreground">شحن رصيد إحدى الخزائن وتحديث الرصيد الحالي</p>
        </div>
        <Button variant="outline" onClick={() => smartBack(navigate, "/accounting")}>
          <ArrowRight size={16} className="ml-1" /> رجوع
        </Button>
      </div>

      {/* Cashboxes summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cashboxes.map((c) => (
          <div key={c.id} className="bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">{c.cashboxName}</p>
              {c.isDefault && <span className="text-[10px] bg-primary/15 text-primary px-2 py-0.5 rounded">افتراضي</span>}
            </div>
            <p className="text-xs text-muted-foreground">{c.employeeName}</p>
            <p className="text-2xl font-bold text-primary mt-2">{c.currentBalance.toLocaleString()} ر.ع</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-6 shadow-card max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label>الخزينة</Label>
            <Select value={cashboxId} onValueChange={setCashboxId}>
              <SelectTrigger><SelectValue placeholder="اختر الخزينة" /></SelectTrigger>
              <SelectContent>
                {cashboxes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.cashboxName} — {c.employeeName} ({c.currentBalance.toLocaleString()} ر.ع)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>المبلغ المضاف (ر.ع)</Label>
            <Input type="number" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.000" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>مصدر التمويل</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="مثل: تحويل بنكي، إيداع نقدي..." />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {selectedCb && amount && (
            <div className="md:col-span-2 bg-primary/5 border border-primary/30 rounded-lg p-3 text-sm">
              الرصيد الجديد المتوقع: <strong className="text-primary">
                {(selectedCb.currentBalance + (parseFloat(amount) || 0)).toLocaleString()} ر.ع
              </strong>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={() => smartBack(navigate, "/accounting")}>إلغاء</Button>
          <Button onClick={handleSave} className="gap-2">
            <Save size={16} /> إضافة الرصيد
          </Button>
        </div>
      </div>
    </div>
  );
}
