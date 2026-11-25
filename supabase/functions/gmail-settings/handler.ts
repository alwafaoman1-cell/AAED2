export interface GmailSettingsDependencies {
  createClient: (url: string, key: string, options?: unknown) => any;
  env: (name: string) => string | undefined;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const email = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const safeStatus = (row: any) => ({
  enabled: !!row?.enabled,
  configured: !!(row?.config?.from_email && row?.config?.client_id && row?.secrets?.client_secret && row?.secrets?.refresh_token),
  fromEmail: row?.config?.from_email || "",
  clientId: row?.config?.client_id || "",
  hasClientSecret: !!row?.secrets?.client_secret,
  hasRefreshToken: !!row?.secrets?.refresh_token,
  updatedAt: row?.updated_at || null,
});

/** Administrative configuration only. This endpoint never sends or refreshes Gmail mail. */
export function createGmailSettingsHandler({ createClient, env }: GmailSettingsDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return json({ ok: true });
    if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
    try {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);
      const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY"), anon = env("SUPABASE_ANON_KEY");
      if (!url || !serviceKey || !anon) throw new Error("gmail_settings_unavailable");
      const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
      const { data: identity, error: authError } = await caller.auth.getUser(auth.slice(7));
      if (authError || !identity?.user) return json({ ok: false, error: "unauthorized" }, 401);
      const admin = createClient(url, serviceKey);
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("user_id,tenant_id,role,account_status,disabled_at").eq("user_id", identity.user.id).maybeSingle();
      if (profileError || profile?.user_id !== identity.user.id || !profile?.tenant_id || profile.role !== "admin"
          || profile.account_status !== "active" || profile.disabled_at) {
        return json({ ok: false, error: "gmail_settings_admin_required" }, 403);
      }
      // Read a bounded request even when Content-Length is absent or forged.
      const reader = req.body?.getReader();
      let size = 0; const chunks: Uint8Array[] = [];
      if (reader) {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.length;
          if (size > 16384) { await reader.cancel(); return json({ ok: false, error: "payload_too_large" }, 413); }
          chunks.push(part.value);
        }
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body: any;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return json({ ok: false, error: "invalid_request" }, 400); }
      if (!body || Array.isArray(body) || typeof body !== "object") return json({ ok: false, error: "invalid_request" }, 400);
      if (body.tenant_id !== profile.tenant_id) return json({ ok: false, error: "gmail_settings_tenant_changed" }, 409);
      const { data: current, error: readError } = await admin.from("tenant_integrations")
        .select("id,tenant_id,provider,enabled,config,secrets,updated_at").eq("tenant_id", profile.tenant_id).eq("provider", "gmail").maybeSingle();
      if (readError) throw new Error("gmail_settings_unavailable");
      if (body.action === "status") return json({ ok: true, status: safeStatus(current) });
      if (body.action !== "save" || typeof body.enabled !== "boolean") return json({ ok: false, error: "invalid_request" }, 400);
      if (body.expected_updated_at !== (current?.updated_at || null)) return json({ ok: false, error: "gmail_settings_stale" }, 409);
      const text = (value: unknown, max: number): string => {
        if (typeof value !== "string" || value.length > max || /[\r\n\0]/.test(value)) throw new Error("gmail_settings_invalid_fields");
        return value.trim();
      };
      const fromEmail = text(body.from_email, 254), clientId = text(body.client_id, 512);
      const clientSecret = text(body.client_secret ?? "", 8192), refreshToken = text(body.refresh_token ?? "", 8192);
      if ((fromEmail && !email.test(fromEmail)) || (clientId && !/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(clientId))) {
        return json({ ok: false, error: "gmail_settings_invalid_fields" }, 400);
      }
      if (clientId !== (current?.config?.client_id || "")
          && (current?.secrets?.client_secret || current?.secrets?.refresh_token) && (!clientSecret || !refreshToken)) {
        return json({ ok: false, error: "gmail_oauth_client_changed_requires_credentials" }, 400);
      }
      const secrets = { ...current?.secrets };
      if (clientSecret) secrets.client_secret = clientSecret;
      if (refreshToken) secrets.refresh_token = refreshToken;
      if (body.enabled && (!fromEmail || !clientId || !secrets.client_secret || !secrets.refresh_token)) {
        return json({ ok: false, error: "gmail_credentials_incomplete" }, 400);
      }
      const update = { enabled: body.enabled, config: { ...current?.config, from_email: fromEmail, client_id: clientId }, secrets };
      let result;
      if (current) {
        let query = admin.from("tenant_integrations").update(update).eq("id", current.id).eq("tenant_id", profile.tenant_id).eq("provider", "gmail");
        query = current.updated_at ? query.eq("updated_at", current.updated_at) : query.is("updated_at", null);
        result = await query.select("enabled,config,secrets,updated_at").maybeSingle();
      } else {
        result = await admin.from("tenant_integrations").insert({ ...update, tenant_id: profile.tenant_id, provider: "gmail" })
          .select("enabled,config,secrets,updated_at").single();
      }
      if (result.error?.code === "23505" || (!result.error && !result.data)) return json({ ok: false, error: "gmail_settings_stale" }, 409);
      if (result.error) throw new Error("gmail_settings_save_failed");
      return json({ ok: true, status: safeStatus(result.data) });
    } catch (error) {
      const code = error instanceof Error && /^gmail_[a-z_]+$/.test(error.message) ? error.message : "gmail_settings_unavailable";
      return json({ ok: false, error: code }, code === "gmail_settings_invalid_fields" ? 400 : 500);
    }
  };
}
