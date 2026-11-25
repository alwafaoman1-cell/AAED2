import { supabase } from "@/integrations/supabase/client";

export interface SavedGmailSettingsStatus {
  enabled: boolean;
  configured: boolean;
  fromEmail: string;
  clientId: string;
  hasClientSecret: boolean;
  hasRefreshToken: boolean;
  updatedAt: string | null;
}

type GmailSettingsRequest = { action: "status"; tenant_id: string } | {
  action: "save";
  tenant_id: string;
  expected_updated_at: string | null;
  enabled: boolean;
  from_email: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

/** Keeps the server's safe error code even when Functions returns HTTP 400/409. */
export async function invokeGmailSettings(body: GmailSettingsRequest): Promise<SavedGmailSettingsStatus> {
  const { data, error } = await supabase.functions.invoke("gmail-settings", { body });
  if (!error && data?.ok === true && data.status) return data.status as SavedGmailSettingsStatus;
  let failure = data;
  if (error?.context instanceof Response) {
    failure = await error.context.clone().json().catch(() => null);
  }
  const code = typeof failure?.error === "string" ? failure.error : "";
  if (/^gmail_[a-z_]+$/.test(code)) throw new Error(code);
  throw new Error(code === "unauthorized" ? "gmail_settings_unauthorized" : "gmail_settings_unavailable");
}
