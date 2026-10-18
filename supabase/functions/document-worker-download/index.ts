import { createDocumentDownloadHandler } from "./handler.ts";

Deno.serve(createDocumentDownloadHandler({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  workerSecret: Deno.env.get("TEMO_DOCUMENT_DOWNLOAD_SECRET") ?? "",
}));
