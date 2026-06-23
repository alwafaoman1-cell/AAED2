import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function resolveDns(name: string, type: "TXT" | "CNAME") {
  const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) return [];
  const result = await response.json();
  return (result.Answer || []).map((answer: { data?: string }) => String(answer.data || "").replace(/^"|"$/g, ""));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) throw new Error("missing_auth");
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, serviceKey);
    const { data: auth } = await caller.auth.getUser();
    if (!auth.user) throw new Error("unauthenticated");
    const { action, domain_id } = await request.json();
    if (action !== "verify" || !domain_id) throw new Error("invalid_request");

    const { data: profile } = await admin.from("profiles")
      .select("tenant_id,role,is_platform_admin,account_status")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (!profile || profile.account_status === "disabled" || !["admin", "manager"].includes(profile.role)) {
      throw new Error("forbidden");
    }

    const { data: domain } = await admin.from("tenant_domains").select("*").eq("id", domain_id).maybeSingle();
    if (!domain) throw new Error("domain_not_found");
    if (!profile.is_platform_admin && profile.tenant_id !== domain.tenant_id) throw new Error("forbidden");

    const [txtAnswers, cnameAnswers] = await Promise.all([
      resolveDns(`_aaed.${domain.hostname}`, "TXT"),
      resolveDns(domain.hostname, "CNAME"),
    ]);
    const tokenVerified = txtAnswers.some((value) => value.includes(domain.verification_token));
    const cnameVerified = cnameAnswers.some((value) => value.toLowerCase().includes("vercel-dns.com"));
    if (!tokenVerified && !cnameVerified) {
      const { data: failed } = await admin.from("tenant_domains").update({
        status: "failed",
        verification_error: "DNS verification record was not found",
      }).eq("id", domain.id).select("*").single();
      return new Response(JSON.stringify({ ok: false, error: "dns_not_verified", domain: failed }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let status = domain.domain_type === "subdomain" ? "active" : "verified";
    let verificationError: string | null = null;
    const vercelToken = Deno.env.get("VERCEL_API_TOKEN");
    const vercelProjectId = Deno.env.get("VERCEL_PROJECT_ID");
    const vercelTeamId = Deno.env.get("VERCEL_TEAM_ID");
    if (vercelToken && vercelProjectId) {
      const query = vercelTeamId ? `?teamId=${encodeURIComponent(vercelTeamId)}` : "";
      const response = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/domains${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${vercelToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: domain.hostname }),
      });
      const result = await response.json();
      if (response.ok || String(result?.error?.code || "").includes("DOMAIN_ALREADY")) {
        status = "active";
      } else {
        verificationError = result?.error?.message || "Vercel domain activation failed";
      }
    }

    const { data: updated, error } = await admin.from("tenant_domains").update({
      status,
      verified_at: new Date().toISOString(),
      activated_at: status === "active" ? new Date().toISOString() : null,
      verification_error: verificationError,
    }).eq("id", domain.id).select("*").single();
    if (error) throw error;
    return new Response(JSON.stringify({ ok: true, domain: updated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
