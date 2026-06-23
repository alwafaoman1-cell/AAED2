import { useEffect, useMemo, useState } from "react";
import {
  Activity, Building2, CheckCircle2, Copy, Database, ExternalLink, FileArchive,
  Globe2, KeyRound, Loader2, LockKeyhole, Mail, MoreHorizontal, Power,
  RefreshCw, Settings2, ShieldCheck, UserPlus, Users, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FEATURE_DEFINITIONS, addDomain, listDomains, listTenantFeatures, listTenants,
  saveTenant, setTenantFeature, verifyDomain, type FeatureKey, type TenantDomain,
  type TenantFeature, type TenantSummary,
} from "@/lib/saasAdmin";
import TenantFiles from "@/pages/admin/TenantFiles";

interface AdminUser {
  id: string;
  user_id: string;
  tenant_id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: AppRole;
  account_status: string;
  last_sign_in_at: string | null;
  last_seen_at: string | null;
  invited_at: string | null;
  created_at: string;
  tenant?: { name?: string; slug?: string };
}

interface UserActivity {
  id: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

const roleLabels: Record<AppRole, string> = {
  admin: "Admin", manager: "Manager", supervisor: "Supervisor",
  technician: "Technician", insurance: "Insurance", accountant: "Accountant",
};

async function invokeUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-users", { body });
  if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
  return data as any;
}

export default function SaasAdminConsole() {
  const { profile, hasRole } = useAuth();
  const [usersList, setUsersList] = useState<AdminUser[]>([]);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [features, setFeatures] = useState<TenantFeature[]>([]);
  const [domains, setDomains] = useState<TenantDomain[]>([]);
  const [selectedTenant, setSelectedTenant] = useState(profile?.tenant_id || "");
  const [loading, setLoading] = useState(true);
  const [userDialog, setUserDialog] = useState(false);
  const [tenantDialog, setTenantDialog] = useState(false);
  const [domainDialog, setDomainDialog] = useState(false);
  const [activityUser, setActivityUser] = useState<AdminUser | null>(null);
  const [activityRows, setActivityRows] = useState<UserActivity[]>([]);
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [featureSettingsKey, setFeatureSettingsKey] = useState<FeatureKey | null>(null);
  const [featureSettingsText, setFeatureSettingsText] = useState("{}");
  const [userForm, setUserForm] = useState({ email: "", full_name: "", phone: "", role: "technician" as AppRole, tenant_id: profile?.tenant_id || "" });
  const [tenantForm, setTenantForm] = useState({ name: "", slug: "", legal_name: "", email: "", phone: "" });
  const [domainForm, setDomainForm] = useState({ hostname: "", domain_type: "custom" as "custom" | "subdomain" });
  const isPlatformAdmin = !!(profile as any)?.is_platform_admin;

  async function loadUsers(tenantId = selectedTenant) {
    const data = await invokeUsers({ action: "list", tenant_id: isPlatformAdmin ? tenantId || undefined : undefined });
    setUsersList(data.users || []);
  }

  async function loadTenantData(tenantId = selectedTenant) {
    if (!tenantId) return;
    const [featureRows, domainRows] = await Promise.all([listTenantFeatures(tenantId), listDomains(tenantId)]);
    setFeatures(featureRows);
    setDomains(domainRows);
  }

  async function load() {
    setLoading(true);
    try {
      const tenantRows = await listTenants();
      setTenants(tenantRows);
      const initialTenant = selectedTenant || profile?.tenant_id || tenantRows[0]?.id || "";
      if (initialTenant !== selectedTenant) setSelectedTenant(initialTenant);
      await Promise.all([loadUsers(initialTenant), loadTenantData(initialTenant)]);
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحميل لوحة الإدارة");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (profile) void load(); }, [profile?.user_id]);
  useEffect(() => { if (selectedTenant) void Promise.all([loadUsers(), loadTenantData(selectedTenant)]); }, [selectedTenant]);

  const featureMap = useMemo(() => new Map(features.map((item) => [item.feature_key, item])), [features]);
  const activeUsers = usersList.filter((user) => user.account_status === "active").length;
  const activeFeatures = features.filter((feature) => feature.enabled).length;
  const stats: Array<{ icon: LucideIcon; title: string; value: number; subtitle: string }> = [
    { icon: Users, title: "Users", value: usersList.length, subtitle: `${activeUsers} active` },
    { icon: Building2, title: "Workshops", value: isPlatformAdmin ? tenants.length : 1, subtitle: "Tenant isolated" },
    { icon: Power, title: "Features", value: activeFeatures, subtitle: `${features.length} configured` },
    { icon: Globe2, title: "Domains", value: domains.length, subtitle: `${domains.filter((domain) => domain.status === "active").length} active` },
  ];

  if (!hasRole("admin", "manager")) {
    return <div className="py-20 text-center text-muted-foreground">Admin access required</div>;
  }

  async function userAction(action: string, user?: AdminUser) {
    try {
      const result = await invokeUsers({ action, id: user?.id, tenant_id: selectedTenant });
      if (result.action_link) {
        await navigator.clipboard.writeText(result.action_link);
        toast.success("تم إنشاء ونسخ رابط دخول آمن");
      } else {
        toast.success("تم تنفيذ الإجراء");
      }
      await loadUsers();
    } catch (error: any) {
      toast.error(error.message);
    }
  }

  async function openUserActivity(user: AdminUser) {
    setActivityUser(user);
    const { data, error } = await (supabase as any)
      .from("admin_user_events")
      .select("id,action,details,created_at")
      .eq("target_user_id", user.user_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast.error(error.message);
      setActivityRows([]);
      return;
    }
    setActivityRows(data || []);
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="rounded-2xl border border-border bg-gradient-to-l from-primary/15 via-card to-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck className="text-primary" /><h1 className="text-2xl font-bold">SaaS Admin Console</h1></div>
            <p className="mt-1 text-sm text-muted-foreground">إدارة المستخدمين والورش والميزات والدومينات والملفات من مكان واحد.</p>
          </div>
          <div className="flex gap-2">
            {isPlatformAdmin && <Button variant="outline" onClick={() => {
              setEditingTenantId(null);
              setTenantForm({ name: "", slug: "", legal_name: "", email: "", phone: "" });
              setTenantDialog(true);
            }}><Building2 size={15} /> Add Workshop</Button>}
            <Button onClick={() => setUserDialog(true)}><UserPlus size={15} /> Add User</Button>
            <Button size="icon" variant="outline" onClick={() => void load()}><RefreshCw size={15} /></Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ icon: Icon, title, value, subtitle }) => (
          <Card key={title} className="p-4">
            <div className="flex items-center gap-3"><div className="rounded-lg bg-primary/10 p-2"><Icon className="text-primary" size={18} /></div><div><p className="text-xs text-muted-foreground">{title as string}</p><p className="text-xl font-bold">{value as number}</p></div></div>
            <p className="mt-2 text-[10px] text-muted-foreground">{subtitle}</p>
          </Card>
        ))}
      </div>

      {isPlatformAdmin && tenants.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <Label className="whitespace-nowrap">Active Workshop</Label>
          <Select value={selectedTenant} onValueChange={setSelectedTenant}>
            <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{tenants.map((tenant) => <SelectItem key={tenant.id} value={tenant.id}>{tenant.name} · {tenant.slug}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      <Tabs defaultValue="users">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="users"><Users size={14} /> Users</TabsTrigger>
          <TabsTrigger value="features"><Power size={14} /> Features</TabsTrigger>
          <TabsTrigger value="workshops"><Building2 size={14} /> Workshops</TabsTrigger>
          <TabsTrigger value="domains"><Globe2 size={14} /> Domains</TabsTrigger>
          <TabsTrigger value="files"><FileArchive size={14} /> Files</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-3">
          {loading ? <Loader2 className="mx-auto my-16 animate-spin" /> : usersList.map((user) => (
            <Card key={user.id} className="p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{user.full_name.slice(0, 2)}</div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{user.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">{user.email}</p>
                    <p className="text-[10px] text-muted-foreground">Last login: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "Never"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={user.role} onValueChange={async (role) => {
                    try {
                      await invokeUsers({ action: "update", id: user.id, role, tenant_id: selectedTenant });
                      toast.success("Role updated");
                      await loadUsers();
                    } catch (error: any) {
                      toast.error(error.message);
                    }
                  }}>
                    <SelectTrigger className="h-8 w-[135px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(roleLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Badge className={user.account_status === "active" ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600"}>{user.account_status}</Badge>
                  {isPlatformAdmin && tenants.length > 0 && (
                    <Select value={user.tenant_id} onValueChange={async (tenantId) => {
                      try {
                        await invokeUsers({ action: "assign_tenant", id: user.id, tenant_id: tenantId });
                        toast.success("Workshop assignment updated");
                        await loadUsers();
                      } catch (error: any) {
                        toast.error(error.message);
                      }
                    }}>
                      <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="Workshop" /></SelectTrigger>
                      <SelectContent>{tenants.map((tenant) => <SelectItem key={tenant.id} value={tenant.id}>{tenant.name}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  <Button size="sm" variant="outline" onClick={() => void userAction("invite", user)}><Mail size={13} /> Invite</Button>
                  <Button size="sm" variant="outline" onClick={() => void userAction("login_link", user)}><KeyRound size={13} /> Login Link</Button>
                  <Button size="sm" variant="outline" onClick={() => void userAction("reset_access", user)}><RefreshCw size={13} /> Reset</Button>
                  <Button size="sm" variant="outline" onClick={() => void userAction(user.account_status === "disabled" ? "enable" : "disable", user)}>
                    {user.account_status === "disabled" ? <CheckCircle2 size={13} /> : <LockKeyhole size={13} />}
                    {user.account_status === "disabled" ? "Enable" : "Disable"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void openUserActivity(user)}><MoreHorizontal size={15} /> Activity</Button>
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="features">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {FEATURE_DEFINITIONS.map(([key, en, ar]) => {
              const row = featureMap.get(key);
              const checked = row?.enabled ?? true;
              return (
                <Card key={key} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-semibold">{en}</p><p className="text-xs text-muted-foreground">{ar}</p></div>
                    <Switch checked={checked} onCheckedChange={async (value) => {
                      await setTenantFeature(selectedTenant, key, value, row?.settings || {});
                      toast.success(`${en}: ${value ? "Enabled" : "Disabled"}`);
                      await loadTenantData();
                    }} />
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[10px] text-muted-foreground">
                    <span>{checked ? "Enabled" : "Disabled"}</span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => {
                      setFeatureSettingsKey(key);
                      setFeatureSettingsText(JSON.stringify(row?.settings || {}, null, 2));
                    }}><Settings2 size={12} /> Settings</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="workshops">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(isPlatformAdmin ? tenants : tenants.filter(t => t.id === selectedTenant)).map((tenant) => (
              <Card key={tenant.id}>
                <CardHeader><CardTitle className="flex items-center justify-between text-base"><span>{tenant.name}</span><Badge variant={tenant.is_active ? "default" : "secondary"}>{tenant.is_active ? "Active" : "Disabled"}</Badge></CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-muted-foreground">{tenant.legal_name || tenant.slug}</p>
                  <p>{tenant.email || "No email"} · {tenant.phone || "No phone"}</p>
                  <p>Plan: {tenant.subscription_plan} / {tenant.subscription_status}</p>
                  <Button variant="outline" size="sm" onClick={() => {
                    setEditingTenantId(tenant.id);
                    setTenantForm({
                      name: tenant.name,
                      slug: tenant.slug || "",
                      legal_name: tenant.legal_name || "",
                      email: tenant.email || "",
                      phone: tenant.phone || "",
                    });
                    setTenantDialog(true);
                  }}><Settings2 size={13} /> Manage Workshop</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="domains" className="space-y-3">
          <div className="flex justify-end"><Button onClick={() => setDomainDialog(true)}><Globe2 size={14} /> Add Domain</Button></div>
          {domains.map((domain) => (
            <Card key={domain.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-semibold" dir="ltr">{domain.hostname}</p><p className="text-xs text-muted-foreground">{domain.domain_type} · Updated {new Date(domain.updated_at).toLocaleString()}</p></div>
                <div className="flex items-center gap-2">
                  <Badge className={domain.status === "active" ? "bg-emerald-500/15 text-emerald-600" : domain.status === "failed" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-600"}>
                    {domain.status === "active" ? <CheckCircle2 size={12} /> : domain.status === "failed" ? <XCircle size={12} /> : <Activity size={12} />} {domain.status}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(domain.verification_token); toast.success("Verification token copied"); }}><Copy size={13} /> DNS Token</Button>
                  <Button size="sm" onClick={async () => {
                    try {
                      const updated = await verifyDomain(domain.id);
                      toast.success(updated.status === "active" ? "Domain activated" : "DNS verified");
                      await loadTenantData();
                    } catch (error: any) {
                      toast.error(error?.message || "Domain verification failed");
                    }
                  }}><ShieldCheck size={13} /> Verify</Button>
                  <Button size="icon" variant="ghost" onClick={() => window.open(`https://${domain.hostname}`, "_blank", "noopener,noreferrer")}><ExternalLink size={14} /></Button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2" dir="ltr">
                <div><span className="font-semibold">CNAME</span><br />{domain.hostname} → cname.vercel-dns.com</div>
                <div><span className="font-semibold">TXT verification</span><br />_aaed.{domain.hostname} → {domain.verification_token}</div>
              </div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="files">
          <TenantFiles tenantId={selectedTenant || undefined} />
        </TabsContent>
      </Tabs>

      <Dialog open={userDialog} onOpenChange={setUserDialog}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>Add / Invite User</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Full name</Label><Input value={userForm.full_name} onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" dir="ltr" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input dir="ltr" value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} /></div>
            <div><Label>Role</Label><Select value={userForm.role} onValueChange={(role) => setUserForm({ ...userForm, role: role as AppRole })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setUserDialog(false)}>Cancel</Button><Button onClick={async () => {
            await invokeUsers({ action: "invite", ...userForm, tenant_id: selectedTenant || profile?.tenant_id });
            toast.success("Invitation sent");
            setUserDialog(false);
            await loadUsers();
          }}><Mail size={14} /> Invite User</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tenantDialog} onOpenChange={setTenantDialog}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>{editingTenantId ? "Manage Workshop" : "Create Workshop"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Name</Label><Input value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} /></div>
            <div><Label>Slug</Label><Input dir="ltr" value={tenantForm.slug} onChange={(e) => setTenantForm({ ...tenantForm, slug: e.target.value })} /></div>
            <div><Label>Legal name</Label><Input value={tenantForm.legal_name} onChange={(e) => setTenantForm({ ...tenantForm, legal_name: e.target.value })} /></div>
            <div><Label>Email</Label><Input dir="ltr" value={tenantForm.email} onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input dir="ltr" value={tenantForm.phone} onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={async () => {
            const saved = await saveTenant({ ...tenantForm, id: editingTenantId || undefined });
            toast.success(editingTenantId ? "Workshop updated" : "Workshop created");
            setTenantDialog(false);
            setSelectedTenant(saved.id);
            await load();
          }}><Building2 size={14} /> {editingTenantId ? "Save Changes" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={domainDialog} onOpenChange={setDomainDialog}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>Add Workshop Domain</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Hostname</Label><Input dir="ltr" placeholder="workshop.example.com" value={domainForm.hostname} onChange={(e) => setDomainForm({ ...domainForm, hostname: e.target.value })} /></div>
            <div><Label>Type</Label><Select value={domainForm.domain_type} onValueChange={(value) => setDomainForm({ ...domainForm, domain_type: value as any })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="custom">Custom Domain</SelectItem><SelectItem value="subdomain">Subdomain</SelectItem></SelectContent></Select></div>
          </div>
          <DialogFooter><Button onClick={async () => { await addDomain(selectedTenant, domainForm.hostname, domainForm.domain_type); toast.success("Domain added. Complete the DNS instructions."); setDomainDialog(false); await loadTenantData(); }}><Globe2 size={14} /> Add Domain</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!activityUser} onOpenChange={(open) => { if (!open) setActivityUser(null); }}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>User Activity · {activityUser?.full_name}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {activityRows.map((row) => (
              <div key={row.id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline">{row.action}</Badge>
                  <span className="text-[10px] text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
                </div>
                {Object.keys(row.details || {}).length > 0 && (
                  <pre className="mt-2 overflow-auto text-[10px] text-muted-foreground" dir="ltr">{JSON.stringify(row.details, null, 2)}</pre>
                )}
              </div>
            ))}
            {activityRows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No activity recorded yet.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!featureSettingsKey} onOpenChange={(open) => { if (!open) setFeatureSettingsKey(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>Feature Settings · {featureSettingsKey}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>JSON settings</Label>
            <Textarea value={featureSettingsText} onChange={(event) => setFeatureSettingsText(event.target.value)} rows={12} dir="ltr" className="font-mono text-xs" />
            <p className="text-[10px] text-muted-foreground">تُحفظ الإعدادات داخل tenant_features ولا تُشارك مع ورشة أخرى.</p>
          </div>
          <DialogFooter><Button onClick={async () => {
            if (!featureSettingsKey) return;
            try {
              const settings = JSON.parse(featureSettingsText || "{}");
              const current = featureMap.get(featureSettingsKey);
              await setTenantFeature(selectedTenant, featureSettingsKey, current?.enabled ?? true, settings);
              toast.success("Feature settings saved");
              setFeatureSettingsKey(null);
              await loadTenantData();
            } catch {
              toast.error("Invalid JSON settings");
            }
          }}><Settings2 size={14} /> Save Settings</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
