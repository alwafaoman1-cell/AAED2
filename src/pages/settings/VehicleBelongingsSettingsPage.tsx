// إعدادات قائمة المقتنيات
import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Item { key: string; label_ar: string; label_en?: string }

export default function VehicleBelongingsSettingsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("workshop_belongings_settings").select("items").maybeSingle();
      if (data?.items) setItems(data.items as any);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const { data: prof } = await supabase.from("profiles").select("tenant_id").maybeSingle();
      if (!prof?.tenant_id) throw new Error("no tenant");
      const { data: existing } = await supabase.from("workshop_belongings_settings").select("id").maybeSingle();
      if (existing?.id) {
        const { error } = await supabase.from("workshop_belongings_settings").update({ items: items as any }).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("workshop_belongings_settings").insert([{ tenant_id: prof.tenant_id, items: items as any }]);
        if (error) throw error;
      }
      toast.success("تم الحفظ");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="inline animate-spin"/></div>;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">قائمة مقتنيات السيارة</h1>
          <p className="text-sm text-muted-foreground">العناصر التي تظهر كـ Checkbox عند استلام المركبة.</p>
        </div>
        <Button onClick={save} disabled={saving} className="gap-1">
          {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} حفظ
        </Button>
      </div>

      <Card className="p-4 space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 items-center">
            <Input placeholder="مفتاح فريد" value={it.key} onChange={(e) => {
              const next = [...items]; next[i] = { ...it, key: e.target.value }; setItems(next);
            }} className="font-mono max-w-[180px]"/>
            <Input placeholder="الاسم بالعربية" value={it.label_ar} onChange={(e) => {
              const next = [...items]; next[i] = { ...it, label_ar: e.target.value }; setItems(next);
            }}/>
            <Input placeholder="English (optional)" value={it.label_en || ""} onChange={(e) => {
              const next = [...items]; next[i] = { ...it, label_en: e.target.value }; setItems(next);
            }}/>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setItems(items.filter((_, x) => x !== i))}>
              <Trash2 size={14}/>
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setItems([...items, { key: "", label_ar: "" }])}>
          <Plus size={14}/> إضافة عنصر
        </Button>
      </Card>
    </div>
  );
}
