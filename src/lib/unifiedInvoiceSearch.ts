import { supabase } from "@/integrations/supabase/client";

export interface UnifiedInvoiceSearchResult {
  source_type: "sales_documents" | "insurance_invoices" | "invoices";
  source_id: string;
  invoice_number: string;
  invoice_type: "cash" | "insurance" | "legacy";
  tenant_id: string;
  is_historical: boolean;
  invoice_date: string | null;
  route: string;
  ambiguous_historical_number: boolean;
}
export async function findUnifiedInvoiceNumber(value: string): Promise<UnifiedInvoiceSearchResult[]> {
  const invoiceNumber = value.trim();
  if (!invoiceNumber) return [];
  const { data, error } = await (supabase.rpc as any)("find_unified_invoice_number", {
    p_invoice_number: invoiceNumber,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : data ? [data] : []) as UnifiedInvoiceSearchResult[];
}
