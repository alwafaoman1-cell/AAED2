import { supabase } from "@/integrations/supabase/client";

export const FEATURE_DEFINITIONS = [
  ["whatsapp", "WhatsApp", "واتساب"],
  ["insurance", "Insurance Module", "وحدة التأمين"],
  ["workshop", "Workshop Module", "إدارة الورشة"],
  ["inventory", "Inventory / Stock", "المخزون"],
  ["ai_assistant", "AI Assistant", "الذكاء الاصطناعي"],
  ["reports", "Reports", "التقارير"],
  ["pdf_archive", "PDF Archive", "أرشيف PDF"],
  ["customer_qr_portal", "Customer QR Portal", "بوابة QR للعملاء"],
  ["supervisor_app", "Supervisor App", "تطبيق المشرف"],
  ["sales_invoices", "Sales Invoices", "فواتير المبيعات"],
  ["insurance_accounting", "Insurance Accounting", "محاسبة التأمين"],
] as const;

export type FeatureKey = (typeof FEATURE_DEFINITIONS)[number][0];

export interface TenantFeature {
  id: string;
  tenant_id: string;
  feature_key: FeatureKey;
  enabled: boolean;
  settings: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string | null;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
  is_active: boolean;
  subscription_plan: string;
  subscription_status: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface TenantDomain {
  id: string;
  tenant_id: string;
  hostname: string;
  domain_type: "subdomain" | "custom";
  status: "pending" | "verified" | "active" | "failed";
  verification_token: string;
  verification_error: string | null;
  dns_instructions: Record<string, unknown>;
  updated_at: string;
}

export interface TenantFileRecord {
  id: string;
  tenant_id: string;
  storage_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  category: string;
  created_at: string;
  customer_id: string | null;
  vehicle_id: string | null;
  claim_id: string | null;
  job_order_id: string | null;
}

export async function getCurrentTenantId(): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("not_authenticated");
  const { data, error } = await supabase.from("profiles").select("tenant_id").eq("user_id", userData.user.id).single();
  if (error || !data?.tenant_id) throw error || new Error("tenant_not_found");
  return data.tenant_id;
}

export async function listTenants(): Promise<TenantSummary[]> {
  const { data, error } = await (supabase.from("tenants") as any).select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveTenant(patch: Partial<TenantSummary> & { name: string; id?: string }): Promise<TenantSummary> {
  const payload = {
    ...patch,
    slug: patch.slug || patch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
  };
  const query = patch.id
    ? (supabase.from("tenants") as any).update(payload).eq("id", patch.id)
    : (supabase.from("tenants") as any).insert(payload);
  const { data, error } = await query.select("*").single();
  if (error) throw error;
  return data;
}

export async function listTenantFeatures(tenantId?: string): Promise<TenantFeature[]> {
  const id = tenantId || await getCurrentTenantId();
  const { data, error } = await (supabase as any).from("tenant_features").select("*").eq("tenant_id", id).order("feature_key");
  if (error) throw error;
  return data || [];
}

export async function setTenantFeature(tenantId: string, featureKey: FeatureKey, enabled: boolean, settings: Record<string, unknown> = {}) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await (supabase as any).from("tenant_features").upsert({
    tenant_id: tenantId,
    feature_key: featureKey,
    enabled,
    settings,
    updated_by: userData.user?.id || null,
  }, { onConflict: "tenant_id,feature_key" });
  if (error) throw error;
}

export async function listDomains(tenantId?: string): Promise<TenantDomain[]> {
  let query = (supabase as any).from("tenant_domains").select("*").order("created_at", { ascending: false });
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function addDomain(tenantId: string, hostname: string, domainType: "subdomain" | "custom") {
  const normalized = hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await (supabase as any).from("tenant_domains").insert({
    tenant_id: tenantId,
    hostname: normalized,
    domain_type: domainType,
    created_by: userData.user?.id,
    dns_instructions: { type: "CNAME", name: normalized, value: "cname.vercel-dns.com" },
  }).select("*").single();
  if (error) throw error;
  const domain = data as TenantDomain;
  const dnsInstructions = {
    cname: { type: "CNAME", name: normalized, value: "cname.vercel-dns.com" },
    verification: { type: "TXT", name: `_aaed.${normalized}`, value: domain.verification_token },
  };
  const { data: updated, error: updateError } = await (supabase as any)
    .from("tenant_domains")
    .update({ dns_instructions: dnsInstructions })
    .eq("id", domain.id)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return updated as TenantDomain;
}

export async function verifyDomain(domainId: string): Promise<TenantDomain> {
  const { data, error } = await supabase.functions.invoke("manage-tenant-domain", {
    body: { action: "verify", domain_id: domainId },
  });
  if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
  return (data as any).domain as TenantDomain;
}

export async function listTenantFiles(category = "all", tenantId?: string): Promise<TenantFileRecord[]> {
  const id = tenantId || await getCurrentTenantId();
  let query = (supabase as any).from("tenant_files").select("*").eq("tenant_id", id).is("deleted_at", null).order("created_at", { ascending: false });
  if (category !== "all") query = query.eq("category", category);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function uploadTenantFile(file: File, category: string, links: Partial<TenantFileRecord> = {}) {
  const tenantId = links.tenant_id || await getCurrentTenantId();
  const safeName = file.name.replace(/[^\w.\-\u0600-\u06FF]+/g, "_");
  const path = `${tenantId}/${category}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from("tenant-files").upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await (supabase as any).from("tenant_files").insert({
    tenant_id: tenantId,
    storage_path: path,
    file_name: file.name,
    content_type: file.type || null,
    size_bytes: file.size,
    category,
    customer_id: links.customer_id || null,
    vehicle_id: links.vehicle_id || null,
    claim_id: links.claim_id || null,
    job_order_id: links.job_order_id || null,
    uploaded_by: userData.user?.id || null,
  }).select("*").single();
  if (error) {
    await supabase.storage.from("tenant-files").remove([path]);
    throw error;
  }
  return data as TenantFileRecord;
}

export async function createSignedFileUrl(record: TenantFileRecord, expiresIn = 900): Promise<string> {
  const { data, error } = await supabase.storage.from("tenant-files").createSignedUrl(record.storage_path, expiresIn);
  if (error || !data?.signedUrl) throw error || new Error("signed_url_failed");
  return data.signedUrl;
}

export async function deleteTenantFile(record: TenantFileRecord) {
  const { error: storageError } = await supabase.storage.from("tenant-files").remove([record.storage_path]);
  if (storageError) throw storageError;
  const { error } = await (supabase as any).from("tenant_files").update({ deleted_at: new Date().toISOString() }).eq("id", record.id);
  if (error) throw error;
}
