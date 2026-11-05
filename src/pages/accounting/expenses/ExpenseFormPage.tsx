import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FolderTree, Loader2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SupplierPicker from "@/components/suppliers/SupplierPicker";
import AiExtractButton from "@/components/ai/AiExtractButton";
import { isDocumentEngineEnabled } from "@/lib/documentExtraction/config";
import { getDocumentAttachment, linkDocumentFile } from "@/lib/documentExtraction/persistence";
import { buildExpenseReceiptSuggestion } from "@/lib/documentExtraction/expenseDraft";
import type { AppliedDocumentContext } from "@/components/ai/AiExtractButton";
import { queryKeys } from "@/lib/queryKeys";
import { deriveExpenseTotals } from "@/lib/expenses/expenseTotals";
import { canManageFinance } from "@/lib/permissions";
import { can, useCan } from "@/lib/rbac";
import { supabase } from "@/integrations/supabase/client";
import { getVehicleVisitDetail } from "@/lib/vehicleVisitLifecycle";
import { hasConfirmedVehicleEntryWorkOrderLink } from "@/lib/vehicleEntryWorkOrderLink";
import { markClean, markDirty } from "@/lib/unsavedWork";
import "@/lib/i18n/expenseEntryForm";
import type { ExpenseEntryFormKey } from "@/lib/i18n/expenseEntryForm";
import {
  ExpenseExactDuplicateError,
  ExpensePotentialDuplicateError,
  requestPotentialDuplicateOverride,
  sha256Blob,
} from "@/lib/expenses/expenseDuplicateGuard";
import {
  ExpenseCreateRetryConflictError, getExpense, listCostCenters, listExpenseCategories, saveExpense, searchExpenseWorkOrders,
  setExpenseAttachments, uploadExpenseAttachment,
} from "@/lib/expenses/expenseClassificationService";

export interface ExpenseFormPageProps {
  recordId?: string;
  supervisorContext?: { entryId?: string; workOrderId?: string; workOrderNumber?: string };
  onSaved?: (expense: any) => void;
  onCancel?: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const empty: any = {
  expense_scope: "work_order", work_order_id: "", linked_work_order_id: "", department_id: "",
  expense_category_id: "", subcategory_id: "", cost_center_id: "", supplier_id: "",
  supplier_tax_number: "", supplier_invoice_number: "", supplier_invoice_date: "",
  payment_method: "cash", description: "", notes: "", reference_number: "", amount: "", attachments: [],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionTargets = "[&_[role=option]]:min-h-11";

// Key the workspace by its real identity so a reused tablet panel cannot carry a
// previous visit's partial-save ID, attachments or classification into the next.
export default function ExpenseFormPage(props: ExpenseFormPageProps = {}) {
  const { expenseId: routeExpenseId } = useParams();
  const expenseId=props.recordId || routeExpenseId;
  const { profile } = useAuth();
  const context = props.supervisorContext;
  const workspaceKey = JSON.stringify([
    profile?.tenant_id, context ? (context.entryId || context.workOrderId || context.workOrderNumber ? "supervisor-row" : "supervisor-operating") : "accounting",
    context?.entryId, context?.workOrderId, props.recordId || (context ? undefined : expenseId),
  ]);
  return <ExpenseEntryForm key={workspaceKey} {...props} expenseId={props.recordId || (context ? undefined : expenseId)} />;
}

function ExpenseEntryForm({ supervisorContext, onSaved, onCancel, expenseId }: ExpenseFormPageProps & { expenseId?: string }) {
  const { t: translate, i18n } = useTranslation();
  const t = (key: ExpenseEntryFormKey, values?: Record<string, unknown>) => translate("expenseEntryForm." + key, values);
  const isAr = i18n.language?.startsWith("ar");
  const isSupervisor = supervisorContext !== undefined;
  const hasSupervisorRow = isSupervisor && Boolean(supervisorContext?.entryId || supervisorContext?.workOrderId || supervisorContext?.workOrderNumber);
  const editing = !!expenseId;
  const [params] = useSearchParams();
  const { profile, user } = useAuth();
  const tenantId = profile?.tenant_id || "";
  const canWrite = useCan("Expenses", "Add/Edit/Delete");
  const nav = useNavigate();
  const qc = useQueryClient();
  const fieldPrefix = useId();
  const fieldId = (field: string) => fieldPrefix + "-" + field;
  const dirtyScope = "expense-entry:" + tenantId + ":" + fieldPrefix;
  const [form, setForm] = useState(() => ({
    ...empty, date: today(),
    expense_scope: isSupervisor && !hasSupervisorRow ? "operating" : "work_order",
    work_order_id: isSupervisor ? "" : params.get("work_order_id") || "",
  }));
  const formBaselineRef = useRef(JSON.stringify(form));
  const supplierBaselineRef = useRef("");
  const detailHydratedRef = useRef(false);
  const [woSearch, setWoSearch] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extractedDocument, setExtractedDocument] = useState<AppliedDocumentContext | null>(null);
  const savedExpenseIdRef = useRef<string | null>(null);
  const createRequestIdRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const completedRef = useRef(false);
  const durableAttachmentsRef = useRef<any[] | null>(null);
  const uploadedAttachmentRef = useRef<{ file: File; attachment: any } | null>(null);
  const [completed, setCompleted] = useState(false);
  const [retryConflictId, setRetryConflictId] = useState<string | null>(null);
  const [conflictPreviewId, setConflictPreviewId] = useState<string | null>(null);
  const [debouncedWo, setDebouncedWo] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedWo(woSearch), 300);
    return () => clearTimeout(timer);
  }, [woSearch]);

  const localizedError = (key: ExpenseEntryFormKey) => Object.assign(new Error(t(key)), { translationKey: key });

  // Never search by plate/number or trust a caller's display number as identity.
  // The lifecycle read is fresh, and the exact UUID read independently supplies
  // tenant/backlink fields for the canonical visit-link guard.
  const readSupervisorWorkOrder = async () => {
    const entryId = supervisorContext?.entryId;
    const requestedId = supervisorContext?.workOrderId;
    if (!tenantId || (!entryId && !requestedId) || (entryId && !uuid.test(entryId)) || (requestedId && !uuid.test(requestedId))) {
      throw localizedError("linkUnavailable");
    }
    let entry: any = null;
    if (entryId) {
      const visit = await getVehicleVisitDetail(entryId, { includeOperationalFile: false });
      entry = visit?.entry;
      if (!entry || entry.id !== entryId || entry.tenant_id !== tenantId) throw localizedError("linkUnavailable");
    }
    const linkedId = requestedId || entry?.work_order_id || entry?.converted_work_order_id
      || entry?.work_order?.id || entry?.converted_work_order?.id;
    if (!linkedId) throw localizedError("noWorkOrder");
    if (!uuid.test(linkedId)) throw localizedError("linkUnavailable");
    const { data: order, error } = await supabase.from("job_orders")
      .select("id,tenant_id,order_number,vehicle_id,vehicle_entry_id,claim_id,work_order_type,deleted_at,archived_at,parent_work_order_id")
      .eq("tenant_id", tenantId).eq("id", linkedId).is("deleted_at", null).is("archived_at", null).maybeSingle();
    if (error || !order || order.id !== linkedId || order.tenant_id !== tenantId || order.deleted_at || order.archived_at) throw localizedError("linkUnavailable");
    // A genuine legacy order may have no entry. If it has an explicit backlink,
    // validate it too; never fabricate an intake merely to attach an expense.
    if (!entry && order.vehicle_entry_id) {
      if (!uuid.test(order.vehicle_entry_id)) throw localizedError("linkUnavailable");
      const visit = await getVehicleVisitDetail(order.vehicle_entry_id, { includeOperationalFile: false });
      entry = visit?.entry;
      if (!entry || entry.id !== order.vehicle_entry_id || entry.tenant_id !== tenantId) throw localizedError("linkUnavailable");
    }
    if (entry && !hasConfirmedVehicleEntryWorkOrderLink(entry, order)) throw localizedError("linkUnavailable");
    return order;
  };
  const supervisorLink = useQuery({
    queryKey: [...queryKeys.expenseManagement.all, "supervisor_link", tenantId, supervisorContext?.entryId, supervisorContext?.workOrderId],
    enabled: hasSupervisorRow && !!tenantId && canWrite,
    queryFn: readSupervisorWorkOrder, staleTime: 0, retry: false,
  });
  const categories = useQuery({
    queryKey: queryKeys.expenseManagement.categories({ tenantId, active: true }),
    enabled: !!tenantId && canWrite, queryFn: () => listExpenseCategories(tenantId, false),
  });
  const detail = useQuery({
    queryKey: [...queryKeys.expenseManagement.detail(expenseId), tenantId],
    enabled: !!tenantId && canWrite && editing, queryFn: () => getExpense(tenantId, expenseId!),
  });
  const workOrders = useQuery({
    queryKey: [...queryKeys.expenseManagement.workOrders(debouncedWo), tenantId],
    enabled: !isSupervisor && !!tenantId && canWrite && debouncedWo.trim().length>=2,
    queryFn: () => searchExpenseWorkOrders(debouncedWo),
  });
  const centers = useQuery({
    queryKey: [...queryKeys.expenseManagement.costCenters, tenantId],
    enabled: !!tenantId && canWrite, queryFn: () => listCostCenters(tenantId),
  });
  const conflictPreview = useQuery({
    queryKey: [...queryKeys.expenseManagement.detail(conflictPreviewId), tenantId, "retry-conflict-preview"],
    enabled: !!tenantId && canWrite && !!conflictPreviewId,
    queryFn: async () => {
      const existing = await getExpense(tenantId, conflictPreviewId!);
      if (existing.id !== conflictPreviewId || existing.tenant_id !== tenantId) throw localizedError("expenseUnavailable");
      return existing;
    }, retry: false, staleTime: 0,
  });
  useEffect(() => {
    if (detail.data && !detailHydratedRef.current && !savedExpenseIdRef.current) {
      const d: any = detail.data;
      const hydrated = { ...empty, date: today(), ...d, amount: String(d.amount ?? d.total ?? ""),
        supplier_tax_number: d.supplier_tax_number || "", work_order_id: d.work_order_id || "", attachments: d.attachments || [] };
      formBaselineRef.current = JSON.stringify(hydrated);
      supplierBaselineRef.current = d.supplier_name || d.beneficiary || "";
      detailHydratedRef.current = true;
      setForm(hydrated);
      setSupplierName(supplierBaselineRef.current);
    }
  }, [detail.data]);
  const scope = editing ? form.expense_scope : hasSupervisorRow ? "work_order" : isSupervisor ? "operating" : form.expense_scope;
  const roots = useMemo(() => (categories.data || []).filter(c => c.level === 1 && (c.expense_scope === scope || c.expense_scope === "both")), [categories.data, scope]);
  const children = useMemo(() => (categories.data || []).filter(c => c.parent_id === form.department_id && (c.expense_scope === scope || c.expense_scope === "both")), [categories.data, form.department_id, scope]);
  const subs = useMemo(() => (categories.data || []).filter(c => c.parent_id === form.expense_category_id), [categories.data, form.expense_category_id]);
  const hasSupplierTaxNumber = Boolean(String(form.supplier_tax_number || "").trim());
  const totals = useMemo(() => deriveExpenseTotals(form.amount,hasSupplierTaxNumber), [form.amount, hasSupplierTaxNumber]);
  const categoryName = (row: { name_ar?: string; name_en?: string; code?: string }) =>
    (isAr ? row.name_ar || row.name_en : row.name_en) || row.code || t("noSelection");
  const errorMessage = (error: Error & { translationKey?: ExpenseEntryFormKey }) => {
    if (error.translationKey) return t(error.translationKey);
    if (error.message.includes("EXPENSE_DUPLICATE_GUARD_UNAVAILABLE")) return t("duplicateGuardUnavailable");
    if (error.message.includes("EXPENSE_CREATE_RETRY_CHANGED")) return t("createRequestConflict");
    if (error.message.includes("EXPENSE_CREATE_REQUEST_UNCONFIRMED")) return t("createRequestUnconfirmed");
    return isAr || !/[\u0600-\u06ff]/.test(error.message) ? error.message : t("saveFailed");
  };
  const linkBlocked = hasSupervisorRow && (!supervisorLink.data || supervisorLink.isError || supervisorLink.isFetching);
  const linkMessage = supervisorLink.isFetching ? t("checkingLink")
    : supervisorLink.error instanceof Error ? errorMessage(supervisorLink.error) : t("linkUnavailable");

  const invalidateExpenseConsumers = () => Promise.all([
    // Include legacy expense keys and report consumers, not just this form's list.
    qc.invalidateQueries({ predicate: query => String(query.queryKey[0] || "").includes("expense") }),
    ...[
      queryKeys.jobOrders.all, ["job_order_inline"], queryKeys.workOrderFinancials.all,
      queryKeys.reports.all, queryKeys.reportCenter.all, queryKeys.monthlyVehicleProfitability.all,
      queryKeys.vehicle360.all, ["vehicle_visit"], ["journal_entries"], ["accounting-reports"],
      ["monthly-workshop-report"], ["sales_financial_summary"], ["dashboard"], queryKeys.suppliers.all,
    ].map(queryKey => qc.invalidateQueries({ queryKey })),
  ]);

  const save = useMutation({
    mutationFn: async ({ overrideReason }: { overrideReason?: string }) => {
      if (!tenantId || !user?.id || !can(profile?.role, "Expenses", "Add/Edit/Delete")) throw new Error(t("forbidden"));
      if (editing && (!detail.isSuccess || !detail.data?.id)) throw new Error(t("expenseUnavailable"));
      // A lost create response must retry the same primary-key UUID. The service
      // verifies its full tenant-scoped signature before recovering that row.
      if (!expenseId && !createRequestIdRef.current) createRequestIdRef.current = crypto.randomUUID();
      const selectedFileHash = file ? await sha256Blob(file) : null;
      const documentHash = selectedFileHash || extractedDocument?.result.sha256 || form.document_sha256 || null;
      // Revalidate after hashing and again for an override attempt, immediately
      // before the write; cached/query-string context never authorizes a link.
      const linkedOrder = hasSupervisorRow ? await readSupervisorWorkOrder() : null;
      if (hasSupervisorRow && (!supervisorLink.data || linkedOrder?.id !== supervisorLink.data.id)) throw new Error(t("linkChanged"));
      let saved = await saveExpense({
        tenant_id: tenantId, date: form.date, expense_scope: scope,
        work_order_id: scope === "work_order" ? (hasSupervisorRow ? linkedOrder!.id : form.work_order_id) : null,
        linked_work_order_id: scope === "work_order" ? (hasSupervisorRow ? linkedOrder!.order_number : form.linked_work_order_id) : null,
        department_id: form.department_id, expense_category_id: form.expense_category_id,
        subcategory_id: form.subcategory_id || null, cost_center_id: form.cost_center_id || null,
        supplier_id: form.supplier_id || null, supplier_tax_number: form.supplier_tax_number || null,
        supplier_invoice_number: form.supplier_invoice_number || null,
        supplier_invoice_date: form.supplier_invoice_date || null, payment_method: form.payment_method,
        description: form.description, notes: form.notes || null, reference_number: form.reference_number || null,
        subtotal: totals.subtotal, vat_amount: totals.vatAmount, total: totals.total,
        is_vat_applicable: hasSupplierTaxNumber, attachments: durableAttachmentsRef.current || form.attachments || [], document_sha256: documentHash,
      }, user.id, expenseId||savedExpenseIdRef.current||undefined, overrideReason, expenseId ? undefined : createRequestIdRef.current || undefined);
      // The voucher is durable even if a later document step fails.
      savedExpenseIdRef.current=saved.id;
      durableAttachmentsRef.current = saved.attachments || [];
      void invalidateExpenseConsumers();
      try {
        const attachments = [...(saved.attachments || [])];
        if (extractedDocument) {
          const documentAttachment = await getDocumentAttachment(extractedDocument.fileId, tenantId);
          if (!attachments.some((item: any) => item.path === documentAttachment.path && item.bucket === documentAttachment.bucket)) attachments.push(documentAttachment);
        }
        if (file && selectedFileHash !== extractedDocument?.result.sha256) {
          const uploaded = uploadedAttachmentRef.current?.file === file
            ? uploadedAttachmentRef.current.attachment : await uploadExpenseAttachment(tenantId, saved.id, file);
          uploadedAttachmentRef.current = { file, attachment: uploaded };
          if(!attachments.some((item:any)=>item.path===uploaded.path&&item.bucket===uploaded.bucket)) attachments.push(uploaded);
        }
        if (attachments.length !== (saved.attachments || []).length) {
          saved = await setExpenseAttachments(tenantId, saved.id, attachments);
          durableAttachmentsRef.current = saved.attachments || attachments;
        }
        if (extractedDocument) await linkDocumentFile({ tenantId, fileId: extractedDocument.fileId, entityType: "expense", entityId: saved.id });
      } catch {
        // لا تُعد إدخال المصروف؛ افتح السند وأضف المرفق أو أعد الربط بالسند نفسه.
        throw new Error(t("attachmentFailed", { voucher: saved.voucher_number || saved.id }));
      }
      return saved;
    },
    onSuccess: async () => {
      await invalidateExpenseConsumers();
      completedRef.current = true;
      markClean(dirtyScope);
      setCompleted(true);
      toast.success(t("saved"));
    },
    onError: (error: Error) => {
      if (error instanceof ExpenseCreateRetryConflictError) {
        setRetryConflictId(error.expenseId);
        toast.error(t("createRequestConflict"), {
          action: { label: t("openExpense"), onClick: () => setConflictPreviewId(error.expenseId) },
        });
        return;
      }
      if (error instanceof ExpensePotentialDuplicateError) return; // Existing manager-only reason prompt is handled below.
      if (error instanceof ExpenseExactDuplicateError) {
        const existing = error.matches[0];
        toast.error(t("exactDuplicate", { voucher: existing?.voucher_number || t("noSelection") }), {
          action: !isSupervisor && existing?.id ? { label: t("openExpense"), onClick: () => nav("/accounting/expenses/" + existing.id + "/edit") } : undefined,
        });
        return;
      }
      toast.error(errorMessage(error));
    },
  });
  const isDirty = !completedRef.current && (save.isPending || JSON.stringify(form) !== formBaselineRef.current
    || supplierName !== supplierBaselineRef.current || woSearch !== "" || !!file || !!extractedDocument);
  useEffect(() => {
    if (isDirty) markDirty(dirtyScope); else markClean(dirtyScope);
  }, [dirtyScope, isDirty]);
  useEffect(() => () => markClean(dirtyScope), [dirtyScope]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saveInFlightRef.current || save.isPending || completedRef.current) return;
    if (!canWrite) { toast.error(t("forbidden")); return; }
    if (linkBlocked) { toast.error(linkMessage); return; }
    if (editing && (!detail.isSuccess || !detail.data?.id)) { toast.error(t("expenseUnavailable")); return; }
    if (!tenantId || !form.department_id || !form.expense_category_id || !form.description.trim() || !totals.total) {
      toast.error(t("required")); return;
    }
    if (scope === "work_order" && !(hasSupervisorRow ? supervisorLink.data?.id : form.work_order_id)) {
      toast.error(t("chooseWorkOrder")); return;
    }
    saveInFlightRef.current = true;
    markDirty(dirtyScope);
    let saved: any;
    try {
      try {
        saved = await save.mutateAsync({});
      } catch (error) {
        if (!(error instanceof ExpensePotentialDuplicateError)) return;
        const reason = requestPotentialDuplicateOverride(error.matches, canManageFinance(), isAr ? "ar" : "en");
        if (!reason) return;
        saved = await save.mutateAsync({ overrideReason: reason });
      }
    } catch {
      // The mutation reports errors, including a failed override or partial save.
      return;
    } finally {
      saveInFlightRef.current = false;
    }
    // Callbacks happen only after the complete, confirmed save. An embedded
    // workspace never navigates into the main accounting application.
    if (onSaved) {
      onSaved(saved);
      createRequestIdRef.current = null;
    } else if (!isSupervisor) {
      nav("/accounting/expenses");
      createRequestIdRef.current = null;
    }
  };
  const cancel = () => {
    if (saveInFlightRef.current) return;
    if (onCancel) onCancel();
    else if (!isSupervisor) nav("/accounting/expenses");
  };
  const pickWo = (w: any) => {
    if (isSupervisor) return;
    setForm({ ...form, work_order_id: w.id, linked_work_order_id: w.order_number });
    setWoSearch(w.order_number + " — " + (w.plate || ""));
  };
  const textField = (name: string, key: ExpenseEntryFormKey, type = "text") => <div>
    <Label htmlFor={fieldId(name)}>{t(key)}</Label>
    <Input id={fieldId(name)} aria-label={t(key)} type={type} value={form[name] || ""}
      onChange={event => setForm({ ...form, [name]: event.target.value })} />
  </div>;
  const controlsDisabled = !canWrite || save.isPending || completed || (editing && !detail.isSuccess);

  return <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6 [&_input]:min-h-11 [&_button]:min-h-11 [&_button]:min-w-11 [&_[role=combobox]]:min-h-11 [&_textarea]:min-h-11" dir={isAr ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{t(editing ? "editExpense" : "addExpense")}</h1><p className="text-sm text-muted-foreground">{t("introduction")}</p></div>
      {!isSupervisor && <Button type="button" variant="outline" className="min-h-11 min-w-11" asChild><Link to="/accounting/expenses/categories"><FolderTree className="me-2 h-4 w-4" aria-hidden="true" />{t("manageCategories")}</Link></Button>}
    </div>
    {!canWrite && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{t("forbidden")}</p>}
    {editing && detail.isLoading && <p role="status">{t("loadingExpense")}</p>}
    {editing && detail.isError && <p role="alert" className="text-destructive">{t("expenseUnavailable")}</p>}
    {retryConflictId && <section className="space-y-3 rounded border border-destructive/50 p-3">
      <p role="alert" className="text-sm text-destructive">{t("createRequestConflict")}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setConflictPreviewId(retryConflictId)}>{t("openExpense")}</Button>
      {conflictPreviewId && <div className="space-y-2 rounded border p-3 text-sm" aria-label={t("existingExpenseReadOnly")}>
        <h2 className="font-semibold">{t("existingExpenseReadOnly")}</h2>
        {conflictPreview.isFetching && <p role="status">{t("loadingExpense")}</p>}
        {conflictPreview.isError && <p role="alert">{t("expenseUnavailable")}</p>}
        {conflictPreview.isSuccess && <dl className="grid gap-2 md:grid-cols-2">
          <div><dt>{t("voucherNumber")}</dt><dd>{conflictPreview.data.voucher_number || conflictPreview.data.id}</dd></div>
          <div><dt>{t("date")}</dt><dd>{conflictPreview.data.date}</dd></div>
          <div><dt>{t("description")}</dt><dd>{String(conflictPreview.data.description || "")}</dd></div>
          <div><dt>{t("total")}</dt><dd>{Number(conflictPreview.data.total || 0).toFixed(3)} {t("currency")}</dd></div>
        </dl>}
      </div>}
    </section>}
    {hasSupervisorRow && <p id={fieldId("link-status")} role={linkBlocked && !supervisorLink.isFetching ? "alert" : "status"} className="rounded border p-3 text-sm">
      {linkBlocked ? linkMessage : t("lockedWorkOrder")}
    </p>}
    <form onSubmit={submit} className="space-y-4" aria-label={t(editing ? "editExpense" : "addExpense")}>
      <fieldset disabled={controlsDisabled} className="min-w-0 space-y-4">
        <Card><CardHeader><CardTitle>{t("scopeAndLink")}</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
          <div><Label htmlFor={fieldId("scope")}>{t("scope")}</Label>
            <Select value={scope} disabled={isSupervisor} onValueChange={value => setForm({ ...form, expense_scope: value, work_order_id: "", linked_work_order_id: "", department_id: "", expense_category_id: "", subcategory_id: "" })}>
              <SelectTrigger id={fieldId("scope")} aria-label={t("scope")}><SelectValue /></SelectTrigger>
              <SelectContent className={optionTargets}><SelectItem value="work_order">{t("workOrderExpense")}</SelectItem><SelectItem value="operating">{t("operatingExpense")}</SelectItem></SelectContent>
            </Select>
          </div>
          {textField("date", "date", "date")}
          {scope === "work_order" && <div className="relative md:col-span-2">
            {hasSupervisorRow ? <>
              <Label htmlFor={fieldId("locked-order")}>{t("selectedWorkOrder")}</Label>
              <Input id={fieldId("locked-order")} aria-label={t("selectedWorkOrder")} readOnly aria-describedby={fieldId("link-status")}
                value={supervisorLink.data?.order_number || supervisorLink.data?.id || ""} />
            </> : <>
              <Label htmlFor={fieldId("work-order-search")}>{t("workOrderSearch")}</Label>
              <div className="flex gap-2"><Input id={fieldId("work-order-search")} aria-label={t("workOrderSearch")} value={woSearch} onChange={event => setWoSearch(event.target.value)} placeholder={t("workOrderPlaceholder")} /><Search className="mt-3 h-4 w-4 shrink-0" aria-hidden="true" /></div>
              {workOrders.isFetching && <span role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("searching")}</span>}
              {workOrders.isError && <p role="alert" className="text-sm text-destructive">{t("workOrderSearchFailed")}</p>}
              {(workOrders.data || []).length > 0 && <div className="mt-1 max-h-48 overflow-auto rounded border bg-background p-1">
                {workOrders.data!.map((w: any) => <button type="button" className="block min-h-11 w-full rounded p-2 text-start hover:bg-muted" key={w.id} onClick={() => pickWo(w)}>
                  {w.order_number} — {w.plate} {w.plate_letters} — {w.customer_name} ({t(w.channel === "insurance" ? "insuranceChannel" : w.channel === "cash" ? "cashChannel" : "unknownChannel")})
                </button>)}
              </div>}
              <p className="mt-1 text-xs text-muted-foreground">{t("selectedWorkOrder")}: {form.linked_work_order_id || form.work_order_id || t("noSelection")}</p>
            </>}
            <p className="mt-1 text-xs text-muted-foreground">{t("workOrderHint")}</p>
          </div>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("classification")}</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3">
          {categories.isError && <div role="alert" className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive md:col-span-3">{t("categoriesFailed")}</div>}
          {!categories.isLoading && !categories.isError && roots.length === 0 && <div role="status" className="rounded border border-warning/40 bg-warning/5 p-3 text-sm md:col-span-3">{t("categoriesEmpty")}</div>}
          <div><Label htmlFor={fieldId("department")}>{t("department")}</Label><Select value={form.department_id || "none"} onValueChange={value => setForm({ ...form, department_id: value, expense_category_id: "", subcategory_id: "" })}>
            <SelectTrigger id={fieldId("department")} aria-label={t("department")}><SelectValue placeholder={t("choose")} /></SelectTrigger><SelectContent className={optionTargets}>{roots.map(c => <SelectItem value={c.id} key={c.id}>{categoryName(c)}</SelectItem>)}</SelectContent>
          </Select></div>
          <div><Label htmlFor={fieldId("category")}>{t("category")}</Label><Select value={form.expense_category_id || "none"} onValueChange={value => setForm({ ...form, expense_category_id: value, subcategory_id: "" })}>
            <SelectTrigger id={fieldId("category")} aria-label={t("category")}><SelectValue placeholder={t("choose")} /></SelectTrigger><SelectContent className={optionTargets}>{children.map(c => <SelectItem value={c.id} key={c.id}>{categoryName(c)}</SelectItem>)}</SelectContent>
          </Select></div>
          <div><Label htmlFor={fieldId("subcategory")}>{t("subcategory")}</Label><Select value={form.subcategory_id || "none"} onValueChange={value => setForm({ ...form, subcategory_id: value === "none" ? "" : value })}>
            <SelectTrigger id={fieldId("subcategory")} aria-label={t("subcategory")}><SelectValue placeholder={t("optional")} /></SelectTrigger><SelectContent className={optionTargets}><SelectItem value="none">{t("none")}</SelectItem>{subs.map(c => <SelectItem value={c.id} key={c.id}>{categoryName(c)}</SelectItem>)}</SelectContent>
          </Select></div>
          <div><Label htmlFor={fieldId("cost-center")}>{t("costCenter")}</Label><Select value={form.cost_center_id || "none"} onValueChange={value => setForm({ ...form, cost_center_id: value === "none" ? "" : value })}>
            <SelectTrigger id={fieldId("cost-center")} aria-label={t("costCenter")}><SelectValue /></SelectTrigger><SelectContent className={optionTargets}><SelectItem value="none">{t("automatic")}</SelectItem>{(centers.data || []).map((c: any) => <SelectItem value={c.id} key={c.id}>{c.code} — {categoryName(c)}</SelectItem>)}</SelectContent>
          </Select></div>
          <div role="group" aria-label={t("supplier")} className="md:col-span-2">
            <SupplierPicker supplierId={form.supplier_id || ""} supplierName={supplierName} label={t("supplier")} placeholder={t("supplierPlaceholder")}
              onChange={supplier => { setForm((current: any) => ({ ...current, supplier_id:supplier.id, supplier_tax_number:supplier.taxNumber||"" })); setSupplierName(supplier.name); }}
              onClear={() => { setForm((current: any) => ({ ...current, supplier_id: "", supplier_tax_number: "" })); setSupplierName(""); }} />
          </div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{t("amountAndDocument")}</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3">
          <div><Label htmlFor={fieldId("amount")}>{t("amount")}</Label><Input id={fieldId("amount")} aria-label={t("amount")} inputMode="decimal" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /><p className="mt-1 text-xs text-muted-foreground">{t("amountHint")}</p></div>
          <div><p id={fieldId("vat")}>{t("vatStatus")}</p><div aria-labelledby={fieldId("vat")} className="min-h-11 rounded border px-3 py-2 text-sm">{t(hasSupplierTaxNumber ? "vatIncluded" : "noVat")}</div></div>
          <div className="rounded border p-3 text-sm" aria-live="polite"><div>{t("subtotal")}: {totals.subtotal.toFixed(3)}</div><div>{t("vat")}: {totals.vatAmount.toFixed(3)}</div><strong>{t("total")}: {totals.total.toFixed(3)} {t("currency")}</strong></div>
          <div><Label htmlFor={fieldId("payment")}>{t("paymentMethod")}</Label><Select value={form.payment_method} onValueChange={value => setForm({ ...form, payment_method: value })}>
            <SelectTrigger id={fieldId("payment")} aria-label={t("paymentMethod")}><SelectValue /></SelectTrigger><SelectContent className={optionTargets}>{(["cash", "bank", "card", "credit"] as const).map(method => <SelectItem key={method} value={method}>{t(method)}</SelectItem>)}</SelectContent>
          </Select></div>
          {textField("supplier_invoice_number", "supplierInvoiceNumber")}
          {textField("supplier_invoice_date", "supplierInvoiceDate", "date")}
          {textField("reference_number", "reference")}
          <div className="md:col-span-3"><Label htmlFor={fieldId("description")}>{t("description")}</Label><Textarea id={fieldId("description")} aria-label={t("description")} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></div>
          <div className="md:col-span-2"><Label htmlFor={fieldId("notes")}>{t("notes")}</Label><Textarea id={fieldId("notes")} aria-label={t("notes")} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></div>
          <div><Label htmlFor={fieldId("attachment")}>{t("attachment")}</Label><Input id={fieldId("attachment")} aria-label={t("attachment")} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => setFile(event.target.files?.[0] || null)} /></div>
          {isDocumentEngineEnabled() && <div className="rounded border p-3 md:col-span-3">
            <AiExtractButton schema="expense_receipt" expectedDocumentType="expense_receipt" className="min-h-11" label={t("readReceipt")} onExtracted={(data, document) => {
              if (!document) return;
              setExtractedDocument(document);
              if(Object.keys(data).length===0) { toast.info(t("documentOnly")); return; }
              const suggested = buildExpenseReceiptSuggestion(data, document.result);
              if (suggested.supplierName) setSupplierName(suggested.supplierName);
              setForm((current: any) => ({ ...current,
                supplier_id: suggested.supplierName ? suggested.supplierId : current.supplier_id,
                supplier_tax_number: suggested.supplierName ? suggested.supplierTaxNumber : current.supplier_tax_number,
                supplier_invoice_number: suggested.supplierInvoiceNumber || current.supplier_invoice_number,
                supplier_invoice_date: suggested.supplierInvoiceDate || current.supplier_invoice_date,
                amount: suggested.amount || current.amount,
              }));
              if (suggested.warning) toast.warning(t("extractionWarning"));
            }} />
            <p className="mt-1 text-xs text-muted-foreground">{t("extractionHint")}</p>
          </div>}
        </CardContent></Card>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11" disabled={controlsDisabled || linkBlocked} aria-busy={save.isPending} aria-describedby={hasSupervisorRow ? fieldId("link-status") : undefined}>
          {save.isPending ? <><Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />{t("saving")}</> : t(completed ? "savedButton" : isSupervisor ? "addExpense" : "saveExpense")}
        </Button>
        {(!isSupervisor || onCancel) && <Button type="button" variant="outline" className="min-h-11" disabled={save.isPending} onClick={cancel}>{t("cancel")}</Button>}
      </div>
    </form>
  </div>;
}
