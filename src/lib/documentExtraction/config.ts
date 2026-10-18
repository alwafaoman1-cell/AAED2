const PROJECTS = {
  development: "rrhyglrnlveygyiandhs",
  production: "ifnfwssdtjuzdtshnrht",
} as const;

/** An explicit feature flag is valid only for the Supabase project built into this app. */
export function isDocumentEngineEnabled(): boolean {
  if (import.meta.env.VITE_DOCUMENT_ENGINE_ENABLED !== "true") return false;
  try {
    const url = new URL(import.meta.env.VITE_SUPABASE_URL);
    const ref = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    return url.protocol === "https:" && url.hostname === `${ref}.supabase.co` &&
      Object.values(PROJECTS).some((allowed) => allowed === ref);
  } catch {
    return false;
  }
}

/** Worker queue is a second, independent switch; never fall back for critical forms. */
export function isDocumentWorkerEnabled(): boolean {
  return isDocumentEngineEnabled() && import.meta.env.VITE_DOCUMENT_WORKER_ENABLED === "true";
}
