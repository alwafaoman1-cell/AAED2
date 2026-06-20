// React Query hooks for print templates with realtime sync
import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DocType, TemplateSchema } from "@/lib/printTemplates/schema";

export interface PrintTemplate {
  id: string;
  tenant_id: string;
  doc_type: DocType;
  name: string;
  description: string | null;
  is_system: boolean;
  is_default: boolean;
  schema: TemplateSchema;
  thumbnail_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const KEY = ["print_templates"] as const;

export function usePrintTemplates(docType?: DocType) {
  const qc = useQueryClient();

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel("print_templates_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "print_templates" },
        () => qc.invalidateQueries({ queryKey: KEY }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PrintTemplate[]> => {
      const { data, error } = await supabase
        .from("print_templates" as any)
        .select("*")
        .order("doc_type")
        .order("is_default", { ascending: false })
        .order("created_at");
      if (error) throw error;
      return (data || []) as unknown as PrintTemplate[];
    },
    staleTime: 30_000,
  });

  const all = query.data || [];
  const filtered = docType ? all.filter((t) => t.doc_type === docType) : all;

  return {
    ...query,
    templates: filtered,
    all,
    countByType: (t: DocType) => all.filter((x) => x.doc_type === t).length,
    defaultFor: (t: DocType) => all.find((x) => x.doc_type === t && x.is_default) || null,
  };
}

export function useTemplateMutations() {
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: async (input: Partial<PrintTemplate> & { doc_type: DocType; name: string; schema: TemplateSchema }) => {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await (supabase as any)
        .from("print_templates")
        .insert({
          tenant_id: tenantId,
          created_by: userRes?.user?.id ?? null,
          doc_type: input.doc_type,
          name: input.name,
          description: input.description ?? null,
          is_system: false,
          is_default: input.is_default ?? false,
          schema: input.schema,
          thumbnail_url: input.thumbnail_url ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PrintTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; patch: Partial<PrintTemplate> }) => {
      const { data, error } = await (supabase as any)
        .from("print_templates")
        .update(input.patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as PrintTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("print_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("print_templates").update({ is_default: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  // Clear is_default for all templates of a doc_type so the system falls back
  // to the built-in (theme-based) PDF generator.
  const clearDefault = useMutation({
    mutationFn: async (docType: DocType) => {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
      const { error } = await (supabase as any)
        .from("print_templates")
        .update({ is_default: false })
        .eq("doc_type", docType)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const duplicate = useMutation({
    mutationFn: async (src: PrintTemplate) => {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
      const { data: userRes } = await supabase.auth.getUser();
      const { data, error } = await (supabase as any)
        .from("print_templates")
        .insert({
          tenant_id: tenantId,
          created_by: userRes?.user?.id ?? null,
          doc_type: src.doc_type,
          name: `${src.name} (نسخة)`,
          description: src.description,
          is_system: false,
          is_default: false,
          schema: src.schema,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PrintTemplate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  return { create, update, remove, setDefault, clearDefault, duplicate };
}
