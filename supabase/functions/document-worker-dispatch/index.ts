import { createDocumentDispatchHandler } from "./handler.ts";

Deno.serve(createDocumentDispatchHandler({
  url: Deno.env.get("SUPABASE_URL") ?? "",
  anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  dispatchUrl: Deno.env.get("TEMO_OCR_DISPATCH_URL") ?? "",
  dispatchSecret: Deno.env.get("TEMO_OCR_DISPATCH_SECRET") ?? "",
}));
