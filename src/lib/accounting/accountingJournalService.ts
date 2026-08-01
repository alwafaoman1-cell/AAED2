import { supabase } from "@/integrations/supabase/client";
import type {
  AccountingJournalEntry, AccountingJournalLine, AccountingSourceLink,
  CreateJournalInput, CreateJournalLineInput,
} from "./accountingTypes";
import { requireTenantId, unwrapAccountingResult } from "./accountingServiceSupport";

export async function createAccountingJournal(input: CreateJournalInput): Promise<AccountingJournalEntry> {
  requireTenantId(input.tenantId);
  const result = await supabase.rpc("create_accounting_journal_entry" as never, {
    p_fiscal_year_id: input.fiscalYearId,
    p_accounting_period_id: input.periodId,
    p_accounting_date: input.accountingDate,
    p_document_date: input.documentDate ?? null,
    p_entry_type: input.entryType ?? "manual",
    p_description_ar: input.descriptionAr ?? null,
    p_description_en: input.descriptionEn ?? null,
    p_reference: input.reference ?? null,
    p_source_type: input.sourceType ?? null,
    p_source_identifier: input.sourceIdentifier ?? null,
  } as never);
  return unwrapAccountingResult<AccountingJournalEntry>(result, "ACCOUNTING_JOURNAL_CREATE_FAILED");
}

export async function addAccountingJournalLine(input: CreateJournalLineInput): Promise<AccountingJournalLine> {
  const result = await supabase.from("accounting_journal_lines" as never).insert({
    tenant_id: requireTenantId(input.tenantId), journal_entry_id: input.journalEntryId,
    account_id: input.accountId, line_number: input.lineNumber, description: input.description ?? null,
    debit: input.debit, credit: input.credit, cost_center_id: input.costCenterId ?? null,
    claim_id: input.claimId ?? null, work_order_id: input.workOrderId ?? null,
    vehicle_id: input.vehicleId ?? null, invoice_id: input.invoiceId ?? null,
    expense_id: input.expenseId ?? null, payment_id: input.paymentId ?? null,
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingJournalLine>(result, "ACCOUNTING_JOURNAL_LINE_CREATE_FAILED");
}

export async function linkAccountingSource(input: Omit<AccountingSourceLink, "id">): Promise<AccountingSourceLink> {
  const result = await supabase.from("accounting_source_links" as never).insert({
    ...input, tenant_id: requireTenantId(input.tenant_id),
  } as never).select("*").single();
  return unwrapAccountingResult<AccountingSourceLink>(result, "ACCOUNTING_SOURCE_LINK_FAILED");
}

export async function getAccountingJournal(tenantId: string, entryId: string): Promise<{
  entry: AccountingJournalEntry; lines: AccountingJournalLine[]; sources: AccountingSourceLink[];
}> {
  const tenant = requireTenantId(tenantId);
  const [entryResult, linesResult, sourcesResult] = await Promise.all([
    supabase.from("accounting_journal_entries" as never).select("*").eq("tenant_id", tenant).eq("id", entryId).single(),
    supabase.from("accounting_journal_lines" as never).select("*").eq("tenant_id", tenant).eq("journal_entry_id", entryId).order("line_number"),
    supabase.from("accounting_source_links" as never).select("*").eq("tenant_id", tenant).eq("journal_entry_id", entryId),
  ]);
  return {
    entry: unwrapAccountingResult<AccountingJournalEntry>(entryResult, "ACCOUNTING_JOURNAL_LOAD_FAILED"),
    lines: unwrapAccountingResult<AccountingJournalLine[]>(linesResult, "ACCOUNTING_JOURNAL_LINES_LOAD_FAILED") ?? [],
    sources: unwrapAccountingResult<AccountingSourceLink[]>(sourcesResult, "ACCOUNTING_JOURNAL_SOURCES_LOAD_FAILED") ?? [],
  };
}
