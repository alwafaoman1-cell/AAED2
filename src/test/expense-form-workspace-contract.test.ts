// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expenseEntryFormStrings } from "@/lib/i18n/expenseEntryForm";
import i18n from "@/i18n";
import ExpenseFormPage from "@/pages/accounting/expenses/ExpenseFormPage";
import { ExpenseCreateRetryConflictError } from "@/lib/expenses/expenseClassificationService";

const runtime = vi.hoisted(() => ({
  save: vi.fn(), upload: vi.fn(), attachments: vi.fn(), getExpense: vi.fn(), navigate: vi.fn(),
  success: vi.fn(), error: vi.fn(), uuid: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: runtime.success, error: runtime.error, info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "tenant-1", role: "supervisor" }, user: { id: "user-1" } }) }));
vi.mock("@/lib/rbac", () => ({ useCan: () => true, can: () => true }));
vi.mock("@/lib/permissions", () => ({ canManageFinance: () => false }));
vi.mock("react-router-dom", () => ({
  useParams: () => ({}), useSearchParams: () => [new URLSearchParams()], useNavigate: () => runtime.navigate,
  Link: ({ children, to, ...props }: any) => createElement("a", { ...props, href: to }, children),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("Unexpected cloud read in the isolated form test"); } } }));
vi.mock("@/lib/vehicleVisitLifecycle", () => ({ getVehicleVisitDetail: vi.fn() }));
vi.mock("@/lib/documentExtraction/config", () => ({ isDocumentEngineEnabled: () => false }));
vi.mock("@/lib/documentExtraction/persistence", () => ({ getDocumentAttachment: vi.fn(), linkDocumentFile: vi.fn() }));
vi.mock("@/lib/documentExtraction/expenseDraft", () => ({ buildExpenseReceiptSuggestion: vi.fn() }));
vi.mock("@/components/suppliers/SupplierPicker", () => ({ default: () => null }));
vi.mock("@/components/ai/AiExtractButton", () => ({ default: () => null }));
vi.mock("@/lib/expenses/expenseDuplicateGuard", () => ({
  ExpenseExactDuplicateError: class extends Error {}, ExpensePotentialDuplicateError: class extends Error {},
  requestPotentialDuplicateOverride: vi.fn(), sha256Blob: async () => "file-hash",
}));
vi.mock("@/lib/expenses/expenseClassificationService", () => ({
  ExpenseCreateRetryConflictError: class extends Error {
    constructor(readonly expenseId: string) { super("EXPENSE_CREATE_RETRY_CHANGED"); }
  },
  saveExpense: runtime.save, getExpense: runtime.getExpense,
  uploadExpenseAttachment: runtime.upload, setExpenseAttachments: runtime.attachments,
  listExpenseCategories: async () => [
    { id: "department-1", level: 1, parent_id: null, expense_scope: "operating", name_ar: "القسم", name_en: "Workshop" },
    { id: "category-1", level: 2, parent_id: "department-1", expense_scope: "operating", name_ar: "التصنيف", name_en: "Consumables" },
  ],
  listCostCenters: async () => [], searchExpenseWorkOrders: async () => [],
}));
// Replace only Radix's popup mechanics. The real form still owns every field,
// validation, mutation, retry, attachment step and completion callback.
vi.mock("@/components/ui/select", async () => {
  const { Children, createElement } = await import("react");
  const SelectTrigger = () => null;
  const SelectContent = () => null;
  return {
    SelectTrigger, SelectContent, SelectValue: () => null,
    SelectItem: ({ value, children }: any) => createElement("option", { value }, children),
    Select: ({ value, children, disabled, onValueChange }: any) => {
      const nodes = Children.toArray(children) as any[];
      const trigger = nodes.find(node => node.type === SelectTrigger);
      const content = nodes.find(node => node.type === SelectContent);
      return createElement("select", {
        id: trigger?.props.id, "aria-label": trigger?.props["aria-label"], value, disabled,
        onChange: (event: any) => onValueChange(event.target.value),
      }, content?.props.children);
    },
  };
});

const source = readFileSync(resolve(process.cwd(), "src/pages/accounting/expenses/ExpenseFormPage.tsx"), "utf8").replace(/\r\n/g, "\n");
const linkRead = source.slice(source.indexOf("const readSupervisorWorkOrder"), source.indexOf("const supervisorLink"));
const mutation = source.slice(source.indexOf("mutationFn:"), source.indexOf("onSuccess:"));
const submit = source.slice(source.indexOf("const submit"), source.indexOf("const cancel"));

describe("shared accounting / supervisor expense form contract", () => {
  it("keeps the existing route default export and optional embedding contract", () => {
    expect(source).toContain("export default function ExpenseFormPage(props: ExpenseFormPageProps = {})");
    expect(source).toContain("supervisorContext?: { entryId?: string; workOrderId?: string; workOrderNumber?: string }");
    expect(source).toContain("onSaved?: (expense: any) => void");
    expect(source).toContain("onCancel?: () => void");
    expect(source).toContain('expenseId={props.recordId || (context ? undefined : expenseId)}');
    expect(source).toContain('recordId?: string');
    expect(source).toContain('props.recordId || (context ? undefined : expenseId)');
    expect(source).toContain("key={workspaceKey}");
    expect(source).toContain('work_order_id: isSupervisor ? "" : params.get("work_order_id") || ""');
  });

  it("checks exact visit and tenant identity with fresh cloud reads and the canonical guard", () => {
    expect(linkRead).toContain('uuid.test(entryId)');
    expect(linkRead).toContain('uuid.test(linkedId)');
    expect(linkRead).toContain("getVehicleVisitDetail(entryId, { includeOperationalFile: false })");
    expect(linkRead).toContain("entry.id !== entryId || entry.tenant_id !== tenantId");
    expect(linkRead).toContain('supabase.from("job_orders")');
    expect(linkRead).toContain('.eq("tenant_id", tenantId).eq("id", linkedId).is("deleted_at", null).is("archived_at", null).maybeSingle()');
    expect(linkRead).toContain("order.id !== linkedId || order.tenant_id !== tenantId");
    expect(linkRead).toContain("order.deleted_at || order.archived_at");
    expect(linkRead).toContain("hasConfirmedVehicleEntryWorkOrderLink(entry, order)");
    expect(linkRead).toContain("if (!entry && order.vehicle_entry_id)");
    expect(linkRead).toContain("getVehicleVisitDetail(order.vehicle_entry_id, { includeOperationalFile: false })");
    expect(linkRead).not.toContain("workOrderNumber");
    expect(mutation.indexOf("await readSupervisorWorkOrder()")).toBeLessThan(mutation.indexOf("await saveExpense("));
    expect(mutation).toContain("linkedOrder?.id !== supervisorLink.data.id");
    expect(mutation).toContain('work_order_id: scope === "work_order" ? (hasSupervisorRow ? linkedOrder!.id : form.work_order_id) : null');
  });

  it("blocks an unlinked visit visibly without inventing an order or operating expense", () => {
    expect(linkRead).toContain('if (!linkedId) throw localizedError("noWorkOrder")');
    expect(source).toContain('const scope = editing ? form.expense_scope : hasSupervisorRow ? "work_order" : isSupervisor ? "operating" : form.expense_scope');
    expect(source).toContain("disabled={isSupervisor}");
    expect(source).toContain('if (linkBlocked) { toast.error(linkMessage); return; }');
    expect(source).toContain("disabled={controlsDisabled || linkBlocked}");
    expect(source).toContain('isSupervisor ? "addExpense" : "saveExpense"');
    expect(source).toContain('role={linkBlocked && !supervisorLink.isFetching ? "alert" : "status"}');
    expect(source).not.toMatch(/createWorkOrder|ensureWorkOrder|convertVehicleEntry|\.insert\(|\.upsert\(/);
  });

  it("treats an explicitly empty supervisor context as general operating entry, never as a missing-order fallback", () => {
    expect(source).toContain('const hasSupervisorRow = isSupervisor && Boolean(supervisorContext?.entryId || supervisorContext?.workOrderId || supervisorContext?.workOrderNumber)');
    expect(source).toContain('expense_scope: isSupervisor && !hasSupervisorRow ? "operating" : "work_order"');
    expect(source).toContain('const linkBlocked = hasSupervisorRow &&');
    expect(source).toContain('enabled: hasSupervisorRow && !!tenantId && canWrite');
    expect(mutation).toContain('const linkedOrder = hasSupervisorRow ? await readSupervisorWorkOrder() : null');
    expect(source).toContain('"supervisor-row" : "supervisor-operating"');
  });

  it("guards writes with the existing expense RBAC action and never changes financial rules", () => {
    expect(source).toContain('useCan("Expenses", "Add/Edit/Delete")');
    expect(mutation).toContain('can(profile?.role, "Expenses", "Add/Edit/Delete")');
    expect(source).toContain("deriveExpenseTotals(form.amount,hasSupplierTaxNumber)");
    expect(mutation).toContain("subtotal: totals.subtotal, vat_amount: totals.vatAmount, total: totals.total");
    expect(mutation).toContain("is_vat_applicable: hasSupplierTaxNumber");
    expect(source).toContain("requestPotentialDuplicateOverride(error.matches, canManageFinance(), isAr ? \"ar\" : \"en\")");
    expect(source).toContain("ExpenseExactDuplicateError");
    expect(source).not.toMatch(/window\.(?:confirm|alert|prompt)|nextExpenseVoucherNumber|accounting_mapping_key|localStorage|service_role/);
  });

  it("holds a synchronous lock across duplicate override and preserves partial-save identity", () => {
    expect(submit).toContain("if (saveInFlightRef.current || save.isPending || completedRef.current) return");
    expect(source).toContain("completedRef.current = true");
    expect(submit.indexOf("saveInFlightRef.current = true")).toBeLessThan(submit.indexOf("await save.mutateAsync({})"));
    expect(submit).toContain("await save.mutateAsync({ overrideReason: reason })");
    expect(submit).toContain("finally {");
    expect(submit).toContain("saveInFlightRef.current = false");
    expect(mutation).toContain("savedExpenseIdRef.current=saved.id");
    expect(mutation).toContain("expenseId||savedExpenseIdRef.current||undefined");
    expect(mutation.indexOf("savedExpenseIdRef.current=saved.id")).toBeLessThan(mutation.indexOf("await uploadExpenseAttachment"));
    expect(mutation).toContain("durableAttachmentsRef.current || form.attachments || []");
    expect(mutation).toContain("uploadedAttachmentRef.current?.file === file");
    expect(mutation).toContain('throw new Error(t("attachmentFailed", { voucher: saved.voucher_number || saved.id }))');
    expect(mutation).toContain("await setExpenseAttachments");
    expect(mutation).toContain("await linkDocumentFile");
    expect(source).toContain('if(Object.keys(data).length===0)');
  });

  it("invalidates expense, job-order, finance and report consumers after confirmed writes", () => {
    expect(mutation.indexOf("savedExpenseIdRef.current=saved.id")).toBeLessThan(mutation.indexOf("void invalidateExpenseConsumers()"));
    for (const key of [
      'includes("expense")', "queryKeys.jobOrders.all", '"job_order_inline"', "queryKeys.workOrderFinancials.all",
      "queryKeys.reports.all", "queryKeys.reportCenter.all", "queryKeys.monthlyVehicleProfitability.all",
      '"accounting-reports"', '"monthly-workshop-report"', '"sales_financial_summary"', '"vehicle_visit"',
    ]) expect(source).toContain(key);
    expect(source).toContain("await invalidateExpenseConsumers()");
    expect(submit.indexOf("onSaved(saved)")).toBeGreaterThan(submit.indexOf("await save.mutateAsync({ overrideReason: reason })"));
    expect(submit).toContain('else if (!isSupervisor) {');
    expect(source).toContain('if (onCancel) onCancel();\n    else if (!isSupervisor) nav("/accounting/expenses")');
  });

  it("retains one create request UUID across uncertain responses without using it as a confirmed edit ID", () => {
    expect(source).toContain('const createRequestIdRef = useRef<string | null>(null)');
    expect(mutation).toContain('if (!expenseId && !createRequestIdRef.current) createRequestIdRef.current = crypto.randomUUID()');
    expect(mutation).toContain('expenseId||savedExpenseIdRef.current||undefined, overrideReason, expenseId ? undefined : createRequestIdRef.current || undefined');
    expect(mutation.indexOf('createRequestIdRef.current = crypto.randomUUID()')).toBeLessThan(mutation.indexOf('await saveExpense('));
    expect(mutation.indexOf('savedExpenseIdRef.current=saved.id')).toBeGreaterThan(mutation.indexOf('await saveExpense('));
    expect(mutation).not.toContain('createRequestIdRef.current = null');
    expect(submit.indexOf('createRequestIdRef.current = null')).toBeGreaterThan(submit.indexOf('onSaved(saved)'));
    expect(source).toContain('ExpenseCreateRetryConflictError');
    expect(source).toContain('EXPENSE_CREATE_RETRY_CHANGED');
    expect(source).toContain('EXPENSE_CREATE_REQUEST_UNCONFIRMED');
  });

  it("keeps a changed-input retry conflict actionable and read-only rather than turning it into an update", () => {
    const conflict = source.slice(source.indexOf('if (error instanceof ExpenseCreateRetryConflictError)'), source.indexOf('if (error instanceof ExpensePotentialDuplicateError) return'));
    expect(conflict).toContain('setRetryConflictId(error.expenseId)');
    expect(conflict).toContain('setConflictPreviewId(error.expenseId)');
    expect(conflict).not.toContain('savedExpenseIdRef.current=');
    expect(conflict).not.toContain('onSaved(');
    expect(source).toContain('await getExpense(tenantId, conflictPreviewId!)');
    expect(source).toContain('existing.id !== conflictPreviewId || existing.tenant_id !== tenantId');
    expect(source).toContain('aria-label={t("existingExpenseReadOnly")}');
  });

  it("registers dirty input and pending saves for the parent's close guard, clearing only on confirmed save or unmount", () => {
    expect(source).toContain('import { markClean, markDirty } from "@/lib/unsavedWork"');
    expect(source).toContain('const dirtyScope = "expense-entry:" + tenantId + ":" + fieldPrefix');
    expect(source).toContain('save.isPending || JSON.stringify(form) !== formBaselineRef.current');
    expect(source).toContain('|| supplierName !== supplierBaselineRef.current || woSearch !== "" || !!file || !!extractedDocument');
    expect(source).toContain('if (isDirty) markDirty(dirtyScope); else markClean(dirtyScope)');
    expect(source).toContain('useEffect(() => () => markClean(dirtyScope), [dirtyScope])');
    expect(submit).toContain('markDirty(dirtyScope)');
    const success = source.slice(source.indexOf('onSuccess:'), source.indexOf('onError:'));
    expect(success).toContain('markClean(dirtyScope)');
    const cancel = source.slice(source.indexOf('const cancel'), source.indexOf('const pickWo'));
    expect(cancel).not.toContain('markClean');
    expect(source).toContain('if (detail.data && !detailHydratedRef.current && !savedExpenseIdRef.current)');
  });

  it("provides matching language resources and tablet-sized accessible form controls", () => {
    const { ar, en } = expenseEntryFormStrings;
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const match of source.matchAll(/\bt\("(\w+)"/g)) expect(en).toHaveProperty(match[1]);
    for (const value of Object.values(en)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/[\u0600-\u06ff]/);
    }
    for (const key of ["noWorkOrder", "linkUnavailable", "forbidden", "attachmentFailed", "addExpense", "saving", "cancel"] as const) {
      expect(ar[key]).toMatch(/[\u0600-\u06ff]/);
      expect(en[key]).not.toMatch(/[\u0600-\u06ff]/);
    }
    expect(en.attachmentFailed).toContain("{{voucher}}");
    expect(ar.attachmentFailed).toContain("{{voucher}}");
    expect(source).toContain('dir={isAr ? "rtl" : "ltr"}');
    expect(source).toContain("aria-busy={save.isPending}");
    expect(source).toContain("[&_input]:min-h-11");
    expect(source).toContain("[&_button]:min-h-11");
    expect(source).toContain("[&_[role=option]]:min-h-11");
    expect(source).toContain('htmlFor={fieldId("description")}');
    expect(source).toContain('aria-label={t("description")}');
    expect(source).toContain('isAr ? row.name_ar || row.name_en : row.name_en');
  });
});

describe("actual shared expense form retry behavior", () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const clients: QueryClient[] = [];
  const row = (input: any, id = requestId) => ({ ...input, id, tenant_id: "tenant-1", voucher_number: "EXP-RETRY-1", amount: input.total, attachments: input.attachments || [] });
  beforeEach(async () => {
    runtime.save.mockReset(); runtime.upload.mockReset(); runtime.attachments.mockReset(); runtime.getExpense.mockReset();
    runtime.navigate.mockReset(); runtime.success.mockReset(); runtime.error.mockReset(); runtime.uuid.mockReset();
    runtime.uuid.mockReturnValue(requestId);
    vi.stubGlobal("crypto", { randomUUID: runtime.uuid });
    await i18n.changeLanguage("en");
    runtime.save.mockImplementation(async (input, _user, id, _reason, createId) => row(input, id || createId));
    runtime.attachments.mockImplementation(async (_tenant, id, attachments) => ({ ...row({ total: 12 }), id, attachments }));
  });
  afterEach(() => {
    cleanup();
    clients.splice(0).forEach(client => client.clear());
    vi.unstubAllGlobals();
  });
  async function mountFilled() {
    const onSaved = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    clients.push(client);
    render(createElement(QueryClientProvider, { client }, createElement(ExpenseFormPage, { supervisorContext: {}, onSaved, onCancel: vi.fn() })));
    await screen.findByRole("option", { name: "Workshop" });
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "department-1" } });
    await screen.findByRole("option", { name: "Consumables" });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "category-1" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Workshop consumables" } });
    fireEvent.change(screen.getByLabelText("Total paid including VAT (OMR)"), { target: { value: "12" } });
    return onSaved;
  }
  async function waitForFailedAttempt() {
    await waitFor(() => expect(runtime.error).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Expense" })).not.toBeDisabled());
  }

  it("reuses the same fifth-argument create UUID after a committed-but-lost response, without converting the retry to an update", async () => {
    runtime.save.mockRejectedValueOnce(new Error("Network response lost after commit"));
    const onSaved = await mountFilled();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitForFailedAttempt();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(runtime.save).toHaveBeenCalledTimes(2);
    const [first, retry] = runtime.save.mock.calls;
    expect(first[4]).toBe(requestId); expect(retry[4]).toBe(requestId);
    expect(first[2]).toBeUndefined(); expect(retry[2]).toBeUndefined();
    expect(retry[0]).toEqual(first[0]);
    expect(runtime.uuid).toHaveBeenCalledOnce();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(onSaved.mock.calls[0][0].id).toBe(requestId);
  });

  it("shows the existing row read-only on changed-input recovery and never silently overwrites it", async () => {
    runtime.save.mockRejectedValueOnce(new Error("Network response lost after commit"))
      .mockRejectedValueOnce(new ExpenseCreateRetryConflictError(requestId));
    const onSaved = await mountFilled();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitForFailedAttempt();
    const originalInput = runtime.save.mock.calls[0][0];
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Changed draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open expense" }));
    runtime.getExpense.mockResolvedValue(row(originalInput));
    // If the query started before its mock was resolved, explicitly retry the
    // test setup is not acceptable: configure the response before opening.
    await waitFor(() => expect(runtime.getExpense).toHaveBeenCalledWith("tenant-1", requestId));
    expect(runtime.save).toHaveBeenCalledTimes(2);
    expect(runtime.save.mock.calls[1][4]).toBe(requestId);
    expect(runtime.save.mock.calls[1][2]).toBeUndefined();
    expect(onSaved).not.toHaveBeenCalled();
    expect(runtime.success).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Description")).toHaveValue("Changed draft");
  });

  it("keeps both the create UUID and confirmed voucher ID when retrying a failed attachment", async () => {
    runtime.upload.mockRejectedValueOnce(new Error("Storage response lost"))
      .mockResolvedValueOnce({ bucket: "expense-documents", path: "receipt.pdf" });
    const onSaved = await mountFilled();
    fireEvent.change(screen.getByLabelText("PDF / image attachment (12 MB)"), {
      target: { files: [new File(["receipt"], "receipt.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitForFailedAttempt();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(runtime.save.mock.calls[0][2]).toBeUndefined();
    expect(runtime.save.mock.calls[1][2]).toBe(requestId);
    expect(runtime.save.mock.calls.map(call => call[4])).toEqual([requestId, requestId]);
    expect(runtime.uuid).toHaveBeenCalledOnce();
    expect(runtime.attachments).toHaveBeenCalledWith("tenant-1", requestId, [{ bucket: "expense-documents", path: "receipt.pdf" }]);
  });

  it("allows only one in-flight mutation even when the form is submitted twice directly", async () => {
    let resolveSave!: (expense: any) => void;
    runtime.save.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
    const onSaved = await mountFilled();
    const form = screen.getByRole("form", { name: "Add Expense" });
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(runtime.save).toHaveBeenCalledOnce());
    await act(async () => { resolveSave(row(runtime.save.mock.calls[0][0])); });
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(runtime.uuid).toHaveBeenCalledOnce();
  });
});
