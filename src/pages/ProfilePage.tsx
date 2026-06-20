import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Save, KeyRound, User as UserIcon, Mail, Phone, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function ProfilePage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const isRtl = i18n.dir() === "rtl";
  const { user, profile, refreshProfile } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // password change
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name || "");
    setPhone(profile?.phone || "");
  }, [profile]);

  async function saveProfile() {
    if (!profile) return;
    if (!fullName.trim()) {
      toast.error(isAr ? "الاسم الكامل مطلوب" : "Full name required");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), phone: phone.trim() || null })
      .eq("user_id", profile.user_id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم حفظ البيانات" : "Profile saved");
    await refreshProfile();
  }

  async function uploadAvatar(file: File) {
    if (!user || !profile) return;
    if (file.size > 5 * 1024 * 1024) { toast.error(isAr ? "الحد الأقصى 5MB" : "Max 5MB"); return; }
    setUploading(true);
    const { convertImageToWebp } = await import("@/lib/imageToWebp");
    const optimized = await convertImageToWebp(file);
    const ext = optimized.name.split(".").pop() || "webp";
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, optimized, { upsert: true, contentType: optimized.type });
    if (upErr) { setUploading(false); toast.error(upErr.message); return; }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ avatar_url: pub.publicUrl })
      .eq("user_id", user.id);
    setUploading(false);
    if (updErr) { toast.error(updErr.message); return; }
    toast.success(isAr ? "تم تحديث الصورة" : "Avatar updated");
    await refreshProfile();
  }

  async function changePassword() {
    if (!newPwd || newPwd.length < 6) { toast.error(isAr ? "كلمة المرور 6 أحرف على الأقل" : "Password ≥ 6 chars"); return; }
    if (newPwd !== confirmPwd) { toast.error(isAr ? "كلمتا المرور غير متطابقتان" : "Passwords don't match"); return; }
    setPwdSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setPwdSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isAr ? "تم تغيير كلمة المرور" : "Password changed");
    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
  }

  if (!profile) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin inline" />
      </div>
    );
  }

  const initials = profile.full_name?.slice(0, 2) || "??";

  return (
    <div className="space-y-6 max-w-4xl mx-auto" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold">{isAr ? "الملف الشخصي" : "My Profile"}</h1>
          <p className="text-sm text-muted-foreground">{isAr ? "إدارة بياناتك وكلمة المرور" : "Manage your info and password"}</p>
        </div>
      </div>

      {/* Header card with avatar */}
      <Card className="p-6">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="relative">
            <Avatar className="w-28 h-28 border-4 border-background shadow-lg">
              <AvatarImage src={profile.avatar_url || undefined} />
              <AvatarFallback className="text-2xl gradient-gold text-primary-foreground">{initials}</AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute bottom-0 end-0 bg-primary text-primary-foreground p-2 rounded-full shadow-md hover:opacity-90 disabled:opacity-50"
              title={isAr ? "تغيير الصورة" : "Change avatar"}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }}
            />
          </div>
          <div className="flex-1 text-center md:text-start">
            <div className="text-xl font-bold">{profile.full_name || "—"}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-2 justify-center md:justify-start mt-1">
              <Mail className="h-3 w-3" /> {user?.email}
            </div>
            <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-primary/10 text-primary text-xs font-medium">
              <Shield className="h-3 w-3" /> {profile.role}
            </div>
          </div>
        </div>
      </Card>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">{isAr ? "البيانات الشخصية" : "Personal Info"}</TabsTrigger>
          <TabsTrigger value="security">{isAr ? "الأمان" : "Security"}</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4">
          <Card className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="flex items-center gap-2"><UserIcon className="h-3 w-3" /> {isAr ? "الاسم الكامل" : "Full name"}</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={100} />
              </div>
              <div>
                <Label className="flex items-center gap-2"><Phone className="h-3 w-3" /> {isAr ? "رقم الهاتف" : "Phone"}</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
              </div>
              <div>
                <Label className="flex items-center gap-2"><Mail className="h-3 w-3" /> {isAr ? "البريد الإلكتروني" : "Email"}</Label>
                <Input value={user?.email || ""} disabled />
              </div>
              <div>
                <Label className="flex items-center gap-2"><Shield className="h-3 w-3" /> {isAr ? "الدور" : "Role"}</Label>
                <Input value={profile.role} disabled />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={saveProfile} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isAr ? "حفظ التغييرات" : "Save changes"}
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <KeyRound className="h-4 w-4" /> {isAr ? "تغيير كلمة المرور" : "Change password"}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>{isAr ? "كلمة المرور الجديدة" : "New password"}</Label>
                <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label>{isAr ? "تأكيد كلمة المرور" : "Confirm password"}</Label>
                <Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={changePassword} disabled={pwdSaving} className="gap-2">
                {pwdSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {isAr ? "تحديث كلمة المرور" : "Update password"}
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
