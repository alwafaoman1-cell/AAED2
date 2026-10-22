import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Entry = {
  id: string;
  date: string;
  source: string;
  sourceId: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description: string;
};

const journal = vi.hoisted(() => ({
  entries: [] as Entry[],
  add: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/journalStore", () => ({
  getJournalForSource: (source: string, sourceId: string) =>
    journal.entries.filter((entry) => entry.source === source && entry.sourceId === sourceId),
  removeJournalBySource: (source: string, sourceId: string) => {
    journal.remove(source, sourceId);
    journal.entries = journal.entries.filter((entry) => entry.source !== source || entry.sourceId !== sourceId);
  },
  addJournalEntry: (entry: Omit<Entry, "id">) => {
    journal.add(entry);
    journal.entries.push({ ...entry, id: `JE-${journal.entries.length + 1}` });
  },
}));

import { postExpense } from "@/lib/salesAccounting";

const expense = {
  expenseId: "expense-1",
  expenseNumber: "PAY-001",
  date: "2026-10-19",
  amount: 25,
  category: "Workshop",
  paidFrom: "cash" as const,
};

describe("legacy expense journal reconciliation", () => {
  beforeEach(() => {
    journal.entries = [];
    journal.add.mockClear();
    journal.remove.mockClear();
  });

  it("does not rewrite a confirmed identical entry on repeated cache notifications", () => {
    postExpense(expense);
    expect(journal.add).toHaveBeenCalledTimes(1);
    expect(journal.remove).not.toHaveBeenCalled();

    postExpense(expense);
    postExpense(expense);
    expect(journal.add).toHaveBeenCalledTimes(1);
    expect(journal.remove).not.toHaveBeenCalled();
  });

  it("does not rewrite a valid historical entry when the same expense has duplicate lines", () => {
    postExpense(expense);
    journal.entries.push({ ...journal.entries[0], id: "JE-legacy-duplicate" });
    journal.add.mockClear();
    journal.remove.mockClear();

    postExpense(expense);
    postExpense(expense);

    expect(journal.entries).toHaveLength(2);
    expect(journal.add).not.toHaveBeenCalled();
    expect(journal.remove).not.toHaveBeenCalled();

    postExpense({ ...expense, amount: 30 });
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].amount).toBe(30);
  });

  it("reconciles conflicting duplicate amounts instead of treating one matching line as sufficient", () => {
    postExpense(expense);
    journal.entries.push({ ...journal.entries[0], id: "JE-stale-duplicate", amount: 12 });
    journal.add.mockClear();
    journal.remove.mockClear();

    postExpense(expense);

    expect(journal.remove).toHaveBeenCalledTimes(1);
    expect(journal.add).toHaveBeenCalledTimes(1);
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].amount).toBe(25);
  });

  it("replaces a changed entry and removes a zeroed entry without creating another", () => {
    postExpense(expense);
    postExpense({ ...expense, amount: 30 });
    expect(journal.remove).toHaveBeenCalledTimes(1);
    expect(journal.add).toHaveBeenCalledTimes(2);
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].amount).toBe(30);

    postExpense({ ...expense, amount: 0 });
    expect(journal.remove).toHaveBeenCalledTimes(2);
    expect(journal.add).toHaveBeenCalledTimes(2);
    expect(journal.entries).toHaveLength(0);
  });

  it("requires confirmed cloud hydration before an automatic expense reconciliation", () => {
    const bridge = readFileSync(resolve(process.cwd(), "src/lib/accountingBridge.ts"), "utf8");
    expect(bridge).toContain("if (!expensesStore.isHydrated()) return;");
    expect(bridge).toContain("await journalStore.refreshConfirmed();");
    expect(bridge).not.toContain("  syncExpensesToJournal();");
  });
});
