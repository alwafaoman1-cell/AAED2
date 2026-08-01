import { supabase } from "@/integrations/supabase/client";
import type {
  AccountingJournalEntry,
  AccountingPostingPreview,
  AccountingSourceType,
} from "./accountingTypes";
import { unwrapAccountingResult } from "./accountingServiceSupport";

export async function approveAccountingJournal(entryId: string): Promise<AccountingJournalEntry> {
  const result = await supabase.rpc("approve_accounting_journal_entry" as never, { p_entry_id: entryId } as never);
  return unwrapAccountingResult<AccountingJournalEntry>(result, "ACCOUNTING_JOURNAL_APPROVE_FAILED");
}
export async function postAccountingJournal(entryId: string): Promise<AccountingJournalEntry> {
  const result = await supabase.rpc("post_accounting_journal_entry" as never, { p_entry_id: entryId } as never);
  return unwrapAccountingResult<AccountingJournalEntry>(result, "ACCOUNTING_JOURNAL_POST_FAILED");
}

export async function reverseAccountingJournal(entryId: string, reversalDate: string, reason: string): Promise<AccountingJournalEntry> {
  const result = await supabase.rpc("reverse_accounting_journal_entry" as never, {
    p_entry_id: entryId, p_reversal_date: reversalDate, p_reason: reason.trim(),
  } as never);
  return unwrapAccountingResult<AccountingJournalEntry>(result, "ACCOUNTING_JOURNAL_REVERSE_FAILED");
}

export async function previewAccountingSourcePosting(input: {
  sourceType: AccountingSourceType;
  sourceId: string;
  eventType: string;
  accountingDate: string;
}): Promise<AccountingPostingPreview> {
  const result = await supabase.rpc("preview_accounting_source_posting" as never, {
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_event_type: input.eventType.trim().toLowerCase(),
    p_accounting_date: input.accountingDate,
  } as never);
  return unwrapAccountingResult<AccountingPostingPreview>(result, "ACCOUNTING_POSTING_PREVIEW_FAILED");
}

export async function postAccountingSource(input: {
  sourceType: AccountingSourceType;
  sourceId: string;
  eventType: string;
  accountingDate: string;
  idempotencyKey: string;
}): Promise<AccountingJournalEntry> {
  const result = await supabase.rpc("post_accounting_source" as never, {
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_event_type: input.eventType.trim().toLowerCase(),
    p_accounting_date: input.accountingDate,
    p_idempotency_key: input.idempotencyKey.trim(),
  } as never);
  return unwrapAccountingResult<AccountingJournalEntry>(result, "ACCOUNTING_SOURCE_POST_FAILED");
}

export async function reverseAccountingSourcePosting(input: {
  sourceType: AccountingSourceType;
  sourceId: string;
  reversalDate: string;
  reason: string;
}): Promise<AccountingJournalEntry> {
  const result = await supabase.rpc("reverse_accounting_source_posting" as never, {
    p_source_type: input.sourceType,
    p_source_id: input.sourceId,
    p_reversal_date: input.reversalDate,
    p_reason: input.reason.trim(),
  } as never);
  return unwrapAccountingResult<AccountingJournalEntry>(result, "ACCOUNTING_SOURCE_REVERSE_FAILED");
}
