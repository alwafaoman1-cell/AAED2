import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";

const sourceText = readFileSync(resolve(process.cwd(), "src/pages/insurance/InsuranceClaimDetail.tsx"), "utf8");
const source = ts.createSourceFile("InsuranceClaimDetail.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T {
  let found: T | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found) throw new Error("The claim controller contract could not be found");
  return found;
}

function variable(name: string): ts.Expression {
  const declaration = findNode((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
  if (!declaration.initializer) throw new Error(`Missing initializer: ${name}`);
  return declaration.initializer;
}

// Execute the actual controller expressions with isolated dependencies, without
// mounting the page or permitting a database, file upload or status mutation.
function compile<T>(expression: ts.Expression, environment: Record<string, unknown>): T {
  const compiled = ts.transpileModule(`const extracted = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(environment), `${compiled}\nreturn extracted;`)(...Object.values(environment)) as T;
}

const invoiceClick = findNode((node): node is ts.ArrowFunction => ts.isArrowFunction(node)
  && ts.isJsxExpression(node.parent)
  && node.body.getText(source).includes("handleSave()")
  && node.body.getText(source).includes("generateTaxInvoice()"));

function saveFixture() {
  const verified = { id: "claim-1", notes: "", tenant_id: "tenant-1", job_order_id: null };
  const update = vi.fn().mockResolvedValue(verified);
  const audit = vi.fn().mockResolvedValue(undefined);
  const environment: Record<string, unknown> = {
    company: "Test insurer", claimNumber: "CLM-1", companyId: "insurer-1", insuranceEmployeeId: null,
    customerId: "11111111-1111-4111-8111-111111111111", vehicleId: "", linkedWorkOrderId: null,
    effectiveEstimate: 100, approvedAmount: "100", ownerName: "Test customer", ownerPhone: "",
    vehicleMake: "", vehicleModel: "", vehiclePlate: "", vehicleYear: "", vehicleColor: "", vehicleVin: "",
    estimationType: "lump_sum", uplItems: [], neededParts: [], estimateDate: "2026-11-15",
    workshopArrivalDate: "2026-11-14", workStartedAt: "2026-11-15", isNew: false, id: "claim-1",
    supabase: { rpc: vi.fn().mockResolvedValue({ data: "tenant-1" }) },
    toast: { error: vi.fn() }, ensureClaimCustomerId: vi.fn().mockResolvedValue("11111111-1111-4111-8111-111111111111"),
    isUuid: (value: string) => /^[a-f\d-]{36}$/i.test(value), parseMoneyInput,
    buildNotesWithLpo: () => "", getLpoValues: () => ({ number: "", date: "", amount: "", note: "" }),
    updateClaim: { mutateAsync: update }, queryClient: { setQueryData: vi.fn() },
    queryKeys: { insuranceClaims: { detail: (id: string) => ["claim", id] } },
    hydrateFromVerifiedClaim: vi.fn(), syncClaimOperationalFile: vi.fn().mockResolvedValue(undefined), writeClaimAudit: audit,
  };
  return { environment, update, audit };
}

describe("claim workspace controller preservation", () => {
  it.each(["update", "audit", "validation", "LPO readback"])("does not issue an invoice after %s failure", async (failure) => {
    const { environment, update, audit } = saveFixture();
    if (failure === "update") update.mockRejectedValue(new Error("Save failed"));
    if (failure === "audit") audit.mockRejectedValue(new Error("Audit failed"));
    if (failure === "validation") environment.claimNumber = "";
    if (failure === "LPO readback") {
      environment.getLpoValues = () => ({ number: "LPO-1", date: "", amount: "", note: "" });
      environment.buildNotesWithLpo = () => "[LPO:LPO-1]";
      const query = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn().mockResolvedValue({ data: null, error: new Error("Readback failed") }) };
      query.update.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.select.mockReturnValue(query);
      environment.supabase = { rpc: vi.fn().mockResolvedValue({ data: "tenant-1" }), from: () => query };
    }
    const handleSave = compile<() => Promise<boolean | undefined>>(variable("handleSave"), environment);
    const generateTaxInvoice = vi.fn();
    const click = compile<() => Promise<void>>(invoiceClick, { handleSave, generateTaxInvoice });
    await click();
    expect(generateTaxInvoice).not.toHaveBeenCalled();
    expect((environment.toast as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalled();
  });

  it("issues an invoice only after verified save and audit, excluding physical custody dates", async () => {
    const { environment, update, audit } = saveFixture();
    const handleSave = compile<() => Promise<boolean | undefined>>(variable("handleSave"), environment);
    const generateTaxInvoice = vi.fn();
    const click = compile<() => Promise<void>>(invoiceClick, { handleSave, generateTaxInvoice });
    await click();
    expect(generateTaxInvoice).toHaveBeenCalledOnce();
    expect(audit.mock.invocationCallOrder[0]).toBeLessThan(generateTaxInvoice.mock.invocationCallOrder[0]);
    const updates = update.mock.calls[0][0].updates;
    expect(updates).not.toHaveProperty("workshop_arrival_date");
    expect(updates).not.toHaveProperty("work_started_at");
    expect(updates).not.toHaveProperty("status");
    expect(updates).not.toHaveProperty("rejection_reason");
    expect(updates.estimate_date).toBe("2026-11-15");
  });

  it("tracks the three newly covered saveable draft fields without treating dedicated rejection as a generic save", () => {
    const initializer = variable("hasUnsavedChanges");
    if (!ts.isCallExpression(initializer)) throw new Error("Expected the single root dirty comparison");
    const comparison = initializer.arguments[0];
    const existing = {
      insurance_company: "", claim_number: "", estimated_cost: 0, approved_amount: 0,
      estimation_type: "lump_sum", upl_items: [], needed_parts: [], status: "pending", rejection_reason: "",
      estimate_date: "2026-11-15", notes: "",
    };
    const baseline: Record<string, unknown> = {
      existing, isNew: false, company: "", companyId: null, insuranceEmployeeId: null, claimNumber: "",
      customerId: "", vehicleId: "", ownerName: "", ownerPhone: "", estimatedCost: "0", approvedAmount: "0",
      vehicleMake: "", vehicleModel: "", vehiclePlate: "", vehicleYear: "", vehicleColor: "", vehicleVin: "",
      estimateDate: "2026-11-15", workshopArrivalDate: "", workStartedAt: "", buildNotesWithLpo: () => "",
      estimationType: "lump_sum", uplItems: [], neededParts: [], status: "pending", rejectionReason: "",
      parseMoneyInput, normalizeClaimEstimationType: (value: unknown) => value || "auto", dateOnly: (value: unknown) => value ? String(value).slice(0, 10) : "",
    };
    expect(compile<() => boolean>(comparison, baseline)()).toBe(false);
    for (const patch of [
      { estimationType: "upl" }, { uplItems: [{ name: "Repair item", amount: 20 }] },
      { neededParts: [{ name: "Bumper", quantity: 1 }] },
    ]) {
      expect(compile<() => boolean>(comparison, { ...baseline, ...patch })()).toBe(true);
    }
    expect(compile<() => boolean>(comparison, baseline)()).toBe(false);
    expect(compile<() => boolean>(comparison, { ...baseline, status: "rejected", rejectionReason: "Insurer declined" })()).toBe(false);
  });

  it("keeps rejection behind its dedicated saved-claim and reason checks", () => {
    const mutate = vi.fn();
    const environment = { id: "claim-1", isNew: false, rejectionReason: "", toast: { error: vi.fn() }, updateStatus: { mutate }, setStatus: vi.fn() };
    compile<() => void>(variable("handleReject"), environment)();
    expect(mutate).not.toHaveBeenCalled();
    compile<() => void>(variable("handleReject"), { ...environment, isNew: true, rejectionReason: "Insurer declined" })();
    expect(mutate).not.toHaveBeenCalled();
    compile<() => void>(variable("handleReject"), { ...environment, rejectionReason: "Insurer declined" })();
    expect(mutate).toHaveBeenCalledExactlyOnceWith(
      { id: "claim-1", status: "rejected", rejection_reason: "Insurer declined" },
      { onSuccess: expect.any(Function) },
    );
  });

  it("retains LPO values when the billing panel unmounts and exposes one editor for either claim mode", () => {
    const initializer = variable("getLpoValues");
    if (!ts.isCallExpression(initializer)) throw new Error("Expected the root LPO reader");
    const getLpoValues = compile<() => unknown>(initializer.arguments[0], {
      lpoNumberRef: { current: null }, lpoDateRef: { current: null }, lpoAmountRef: { current: null }, lpoNoteRef: { current: null },
      lpoNumber: "LPO-1", lpoDate: "2026-11-15", lpoAmount: "100.000", lpoNote: "Saved draft note",
    });
    expect(getLpoValues()).toEqual({ number: "LPO-1", date: "2026-11-15", amount: "100.000", note: "Saved draft note" });
    expect(sourceText).toContain("{isNew && lpoInvoiceSection}");
    expect(sourceText).toContain("{!isNew && lpoInvoiceSection}");
  });

  it("keeps approval and actual-arrival shortcuts on the existing controlled workflow", () => {
    expect(sourceText).toContain('if (requestedVisitAction === "approve" && existing.status === "pending") openApproveDialog();');
    expect(sourceText).toContain('document.getElementById("claim-record-vehicle-arrival")');
    expect(sourceText).toContain('disabled={!confirmedActualArrival || registeringVehicleEntry}');
    expect(sourceText).not.toContain('TabsContent forceMount');
    expect(sourceText).not.toContain('forceMount value="payments"');
  });
});
