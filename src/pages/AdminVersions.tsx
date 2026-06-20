// Admin page to publish new app versions. Inserts into `app_versions`;
// Realtime then notifies every connected user via UpdateNotice.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Trash2 } from "lucide-react";
import { CURRENT_APP_VERSION } from "@/lib/appVersion";

interface Row {
  id: string;
  version: string;
  title: string | null;
  changelog: string | null;
  released_at: string;
  mandatory: boolean;
  grace_minutes: number;
}

export default function AdminVersions() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [changelog, setChangelog] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [grace, setGrace] = useState(60);

  async function load() {
    const { data, error } = await supabase
      .from("app_versions")
      .select("id,version,title,changelog,released_at,mandatory,grace_minutes")
      .order("released_at", { ascending: false })
      .limit(20);
    if (error) { toast.error(error.message); return; }
    setRows((data || []) as Row[]);
  }

  useEffect(() => { load(); }, []);

  async function handlePublish() {
    if (!version.trim()) { toast.error("أدخل رقم الإصدار"); return; }
    if (!profile?.tenant_id) { toast.error("الجلسة غير صالحة"); return; }
    setLoading(true);
    const { error } = await supabase.from("app_versions").insert({
      tenant_id: profile.tenant_id,
      version: version.trim(),
      title: title.trim() || null,
      changelog: changelog.trim() || null,
      mandatory,
      grace_minutes: grace,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم نشر الإصدار. سيتلقى جميع المستخدمين الإشعار فوراً.");
    setVersion(""); setTitle(""); setChangelog(""); setMandatory(false); setGrace(60);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("حذف هذا الإصدار من السجل؟")) return;
    const { error } = await supabase.from("app_versions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم الحذف");
    load();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          إدارة تحديثات النظام
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          الإصدار الحالي المنشور في هذا البِنية: <span className="font-mono">{CURRENT_APP_VERSION}</span>
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>نشر إصدار جديد</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>رقم الإصدار الجديد *</Label>
              <Input
                placeholder="مثل: 2026.06.21"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="font-mono"
              />
            </div>
            <div>
              <Label>عنوان التحديث</Label>
              <Input
                placeholder="مثل: تحسينات على الفواتير"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>أهم التحسينات والإصلاحات</Label>
            <Textarea
              rows={6}
              placeholder="• إصلاح ظهور رقم الفاتورة في PDF&#10;• مركز إشعارات جديد&#10;• تحسين الأداء"
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium text-sm">تحديث إجباري</div>
              <div className="text-xs text-muted-foreground">
                سيُطبَّق تلقائياً بعد المهلة المحددة (مع تحذير المستخدم لحفظ عمله).
              </div>
            </div>
            <Switch checked={mandatory} onCheckedChange={setMandatory} />
          </div>
          {mandatory && (
            <div>
              <Label>مهلة الحفظ (دقائق)</Label>
              <Input
                type="number"
                min={5}
                max={1440}
                value={grace}
                onChange={(e) => setGrace(Math.max(5, parseInt(e.target.value) || 60))}
                className="w-32"
              />
            </div>
          )}
          <Button onClick={handlePublish} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            نشر التحديث للمستخدمين
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>سجل الإصدارات</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">لا توجد إصدارات منشورة بعد.</div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 border rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold">{r.version}</span>
                      {r.title && <span className="text-sm">— {r.title}</span>}
                      {r.mandatory && <Badge variant="destructive" className="text-xs">إجباري</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(r.released_at).toLocaleString("en-GB")}
                    </div>
                    {r.changelog && (
                      <pre className="text-xs whitespace-pre-wrap mt-2 text-muted-foreground font-sans">{r.changelog}</pre>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
