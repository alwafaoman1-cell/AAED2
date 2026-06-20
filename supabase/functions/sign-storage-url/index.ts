import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  bucket: string;
  paths: string[];
  expiresIn?: number;
}

const safePath = (path: string) => path.replace(/^\/+/, "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("missing_auth");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await caller.auth.getUser();
    if (!userData.user) throw new Error("unauthenticated");

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, role")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!profile?.tenant_id) throw new Error("profile_not_found");

    const body = (await req.json()) as Body;
    const bucket = String(body.bucket || "");
    const ALLOWED_BUCKETS = ["damage-photos", "insurance-docs", "invoices-pdf", "avatars"];
    const ADMIN_ONLY_BUCKETS = ["backups"];
    const isAdmin = profile.role === "admin" || profile.role === "manager";
    if (ADMIN_ONLY_BUCKETS.includes(bucket)) {
      if (!isAdmin) throw new Error("forbidden_bucket");
    } else if (!ALLOWED_BUCKETS.includes(bucket)) {
      throw new Error("forbidden_bucket");
    }
    const paths = Array.from(new Set((body.paths || []).map(safePath).filter(Boolean))).slice(0, 100);
    const expiresIn = Math.min(Math.max(Number(body.expiresIn) || 604800, 60), 604800);

    const urls: Array<{ path: string; signedUrl: string | null; error?: string }> = [];

    for (const path of paths) {
      try {
        if (path.includes("..")) throw new Error("invalid_path");
        const parts = path.split("/");
        const tenantRoot = parts[0];
        let allowed = tenantRoot === profile.tenant_id;

        if (!allowed && bucket === "insurance-docs" && tenantRoot === "claims" && parts[1]) {
          const { data: claim } = await admin
            .from("insurance_claims")
            .select("id")
            .eq("id", parts[1])
            .eq("tenant_id", profile.tenant_id)
            .maybeSingle();
          allowed = !!claim;
        }

        if (!allowed) throw new Error("forbidden");

        const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, expiresIn);
        if (error || !data?.signedUrl) throw error || new Error("sign_failed");
        urls.push({ path, signedUrl: data.signedUrl });
      } catch (e) {
        urls.push({ path, signedUrl: null, error: e instanceof Error ? e.message : "sign_failed" });
      }
    }

    return new Response(JSON.stringify({ urls }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown_error" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});