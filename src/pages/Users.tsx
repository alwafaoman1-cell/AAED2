import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, AppRole } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Trash2, UserPlus, Upload } from "lucide-react";
import { toast } from "sonner";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";

interface AppUser {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: AppRole;
  avatar_url: string | null;
  created_at: string;
}

const roleLabels: Record<AppRole, string> = {
  admin: "مدير النظام",
  manager: "مدير",
  supervisor: "مشرف",
  technician: "فني",
  insurance: "موظف تأمين",
  accountant: "محاسب",
};

const roleColors: Record<AppRole, string> = {
  admin: "bg-red-500/15 text-red-600 dark:text-red-400",
  manager: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  supervisor: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  technician: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  insurance: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  accountant: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
};

export default function Users() {
  const { profile, hasRole } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);

  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    phone: "",
    role: "technician" as AppRole,
    avatar_url: "",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "list" },
    });
    setLoading(false);
    if (error) {
      toast.error("تعذر تحميل المستخدمين");
      return;
    }
    setUsers((data as { users: AppUser[] })?.users || []);
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setEditing(null);
    setForm({ email: "", password: "", full_name: "", phone: "", role: "technician", avatar_url: "" });
    setShowForm(true);
  }

  function openEdit(u: AppUser) {
    setEditing(u);
    setForm({
      email: u.email || "",
      password: "",
      full_name: u.full_name,
      phone: u.phone || "",
      role: u.role,
      avatar_url: u.avatar_url || "",
    });
    setShowForm(true);
  }

  async function handleAvatar(file: File) {
    if (!profile) return;
    setUploading(true);
    const { convertImageToWebp } = await import("@/lib/imageToWebp");
    const optimized = await convertImageToWebp(file);
    const ext = optimized.name.split(".").pop() || "webp";
    const path = `${profile.user_id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, optimized, {
      upsert: true,
      contentType: optimized.type,
    });
    if (upErr) {
      toast.error("فشل رفع الصورة: " + upErr.message);
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    setForm((f) => ({ ...f, avatar_url: pub.publicUrl }));
    setUploading(false);
    toast.success("تم رفع الصورة");
  }

  async function handleSave() {
    if (!form.full_name || !form.email) {
      toast.error("الاسم والبريد مطلوبان");
      return;
    }
    if (!editing && !form.password) {
      toast.error("كلمة المرور مطلوبة للمستخدم الجديد");
      return;
    }
    setSaving(true);
    const payload = editing
      ? {
          action: "update",
          id: editing.id,
          full_name: form.full_name,
          phone: form.phone,
          role: form.role,
          avatar_url: form.avatar_url,
          ...(form.password ? { password: form.password } : {}),
          ...(form.email !== editing.email ? { email: form.email } : {}),
        }
      : {
          action: "create",
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          phone: form.phone,
          role: form.role,
          avatar_url: form.avatar_url,
        };
    const { data, error } = await supabase.functions.invoke("manage-users", { body: payload });
    setSaving(false);
    const errMsg = (data as { error?: string })?.error || error?.message;
    if (errMsg) {
      toast.error(errMsg);
      return;
    }
    toast.success(editing ? "تم التحديث" : "تم إنشاء المستخدم");
    setShowForm(false);
    load();
  }

  async function handleDelete() {
    if (!deleting) return;
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "delete", id: deleting.id },
    });
    const errMsg = (data as { error?: string })?.error || error?.message;
    if (errMsg) {
      toast.error(errMsg);
      return;
    }
    toast.success("تم الحذف");
    setDeleting(null);
    load();
  }

  if (!hasRole("admin", "manager")) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        لا تملك صلاحية الوصول إلى إدارة المستخدمين
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserPlus className="w-6 h-6 text-primary" />
            إدارة المستخدمين
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            إنشاء وتعديل حسابات الموظفين والصلاحيات
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="w-4 h-4 ml-2" />
          مستخدم جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">قائمة المستخدمين ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
            </div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">لا يوجد مستخدمون</div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-4 p-4 rounded-lg border border-border/60 hover:bg-muted/30 transition"
                >
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={u.avatar_url || undefined} />
                    <AvatarFallback>{u.full_name.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{u.full_name}</div>
                    <div className="text-xs text-muted-foreground truncate" dir="ltr">
                      {u.email}
                    </div>
                    {u.phone && (
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {u.phone}
                      </div>
                    )}
                  </div>
                  <Badge className={roleColors[u.role]}>{roleLabels[u.role]}</Badge>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(u)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setDeleting(u)}
                      disabled={u.user_id === profile?.user_id}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل المستخدم" : "مستخدم جديد"}</DialogTitle>
            <DialogDescription>
              {editing ? "حدّث بيانات المستخدم. اترك كلمة المرور فارغة لعدم تغييرها." : "أدخل بيانات المستخدم الجديد"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="w-20 h-20">
                <AvatarImage src={form.avatar_url || undefined} />
                <AvatarFallback>{form.full_name.slice(0, 2) || "?"}</AvatarFallback>
              </Avatar>
              <div>
                <input
                  id="avatar"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("avatar")?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                  ) : (
                    <Upload className="w-4 h-4 ml-2" />
                  )}
                  رفع صورة
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>الاسم الكامل *</Label>
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div>
                <Label>الجوال</Label>
                <Input value={form.phone} dir="ltr" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>البريد الإلكتروني *</Label>
                <Input
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <Label>كلمة المرور {editing && "(اترك فارغاً لعدم التغيير)"}</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label>الدور *</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(roleLabels) as AppRole[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabels[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              {editing ? "حفظ التغييرات" : "إنشاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title="حذف المستخدم"
        description={`سيتم حذف الحساب "${deleting?.full_name}" نهائياً.`}
      />
    </div>
  );
}
