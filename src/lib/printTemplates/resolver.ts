// Resolver — checks for active custom template; falls back to legacy generator
// Caches templates from Supabase via React Query KEY for instant access (Realtime updates).
import { supabase } from "@/integrations/supabase/client";
import type { DocType, TemplateSchema } from "./schema";
import { renderTemplate } from "./renderer";
import type { QueryClient } from "@tanstack/react-query";

let _qc: QueryClient | null = null;
export const setTemplateQueryClient = (qc: QueryClient) => { _qc = qc; };

interface CachedTemplate {
  id: string;
  doc_type: DocType;
  is_default: boolean;
  schema: TemplateSchema;
  name: string;
}

const TEMPLATES_KEY = ["print_templates"];

function readCache(): CachedTemplate[] {
  if (!_qc) return [];
  return (_qc.getQueryData(TEMPLATES_KEY) as CachedTemplate[]) || [];
}

export function getActiveTemplate(docType: DocType): CachedTemplate | null {
  const all = readCache();
  return all.find((t) => t.doc_type === docType && t.is_default) || null;
}

/**
 * Render a document using the active custom template if available.
 * Returns null when no custom template exists — caller should fallback to legacy generator.
 */
export function renderWithCustomTemplate(docType: DocType, data: any, title?: string): string | null {
  const tpl = getActiveTemplate(docType);
  if (!tpl) return null;
  return renderTemplate(tpl.schema, data, title || tpl.name);
}

/** Async fallback: fetch directly if cache is empty (rare) */
export async function fetchActiveTemplate(docType: DocType): Promise<CachedTemplate | null> {
  const cached = getActiveTemplate(docType);
  if (cached) return cached;
  try {
    const { data, error } = await (supabase as any)
      .from("print_templates")
      .select("id,doc_type,is_default,schema,name")
      .eq("doc_type", docType)
      .eq("is_default", true)
      .maybeSingle();
    if (error || !data) return null;
    return data as CachedTemplate;
  } catch {
    return null;
  }
}
