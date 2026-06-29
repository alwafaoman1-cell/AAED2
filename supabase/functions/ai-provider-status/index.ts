// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDERS = ["openai", "gemini", "anthropic", "custom"] as const;
const PROVIDER_KEYS = PROVIDERS.map((p) => `ai_${p}`);

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAdmin(profile: any) {
  return ["admin", "owner", "super_admin"].includes(String(profile?.role || "")) || !!profile?.is_platform_admin;
}

function maskKey(key?: string | null) {
  if (!key) return null;
  const prefix = key.startsWith("sk-ant-") ? "sk-ant-" : key.startsWith("sk-") ? "sk-" : key.startsWith("AIza") ? "AIza" : key.slice(0, 3);
  return `${prefix}****${key.slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id,role,is_platform_admin")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!profile?.tenant_id) return json({ ok: false, error: "tenant_not_found" }, 400);
    if (!isAdmin(profile)) return json({ ok: false, error: "owner_or_super_admin_required" }, 403);

    const { data: rows } = await admin
      .from("tenant_integrations")
      .select("provider,enabled,config,secrets,status,last_test_at,last_error")
      .eq("tenant_id", profile.tenant_id)
      .in("provider", PROVIDER_KEYS);

    const providers = Object.fromEntries(PROVIDERS.map((p) => [p, {
      configured: false,
      enabled: false,
      maskedKey: null,
      model: "",
      baseUrl: "",
      lastTestAt: null,
      lastTestStatus: null,
      lastTestError: null,
    }]));
    let activeProvider = "none";

    for (const row of rows || []) {
      const provider = String(row.provider || "").replace(/^ai_/, "");
      if (!providers[provider]) continue;
      const config = row.config || {};
      const secrets = row.secrets || {};
      providers[provider] = {
        configured: !!secrets.api_key,
        enabled: !!row.enabled,
        maskedKey: maskKey(secrets.api_key),
        model: config.model || "",
        baseUrl: config.base_url || "",
        lastTestAt: row.last_test_at || null,
        lastTestStatus: row.status || null,
        lastTestError: row.last_error || null,
      };
      if (row.enabled && secrets.api_key) activeProvider = provider;
    }

    const fallback = {
      lovable: !!Deno.env.get("LOVABLE_API_KEY"),
      openai: !!Deno.env.get("OPENAI_API_KEY"),
      gemini: !!Deno.env.get("GEMINI_API_KEY"),
      anthropic: !!Deno.env.get("ANTHROPIC_API_KEY"),
    };

    return json({ ok: true, activeProvider, providers, fallback });
  } catch (error) {
    const code = String(error?.message || error || "server_function_failed");
    return json({ ok: false, error: code, message: code }, 200);
  }
});
