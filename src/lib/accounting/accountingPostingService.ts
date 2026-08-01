import { supabase } from "@/integrations/supabase/client";
import type { AccountingJournalEntry } from "./accountingTypes";
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
