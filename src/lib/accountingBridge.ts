// Read-only compatibility facade. Opening a page is not a business command.
// Vehicle custody/archive belongs to the confirmed visit lifecycle; journal
// writes belong to explicit financial commands, never to cache hydration.
import { removeJournalBySource, journalStore } from "./journalStore";

/** @deprecated Retained for old importers; intentionally installs no effects. */
export function startAccountingBridge() {
  // No auto-posting, archive changes, subscriptions or historical backfill.
}

/** يُستخدم في صفحة دفتر اليومية لمعاينة عدد القيود الحالية */
export function getJournalEntriesCount(): number {
  return journalStore.getAll().length;
}

export { removeJournalBySource };
