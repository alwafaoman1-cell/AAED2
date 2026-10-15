const DEVELOPMENT_REF = "rrhyglrnlveygyiandhs";

/** Double gate: an accidental Production env toggle cannot call Development-only tables. */
export function isDocumentEngineEnabled(): boolean {
  if (import.meta.env.VITE_DOCUMENT_ENGINE_ENABLED !== "true") return false;
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).hostname === `${DEVELOPMENT_REF}.supabase.co`;
  } catch {
    return false;
  }
}

/** Separate queue consumer is never used against the Production project. */
export function isDocumentWorkerEnabled(): boolean {
  return isDocumentEngineEnabled() && import.meta.env.VITE_DOCUMENT_WORKER_ENABLED === "true";
}
