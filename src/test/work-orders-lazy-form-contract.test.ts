import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Inspect the actual page AST without mounting its unrelated data stores/dialogs.
const source = ts.createSourceFile("WorkOrders.tsx", readFileSync(resolve(process.cwd(), "src/pages/WorkOrders.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const formPath = "@/components/workorders/WorkOrderForm";
function nodes<T extends ts.Node>(root: ts.Node, matches: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node) => { if (matches(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return found;
}
function ancestor(element: ts.Node, tag: string): ts.JsxElement | undefined {
  for (let parent = element.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === tag) return parent;
  }
  return undefined;
}
function attribute(element: ts.JsxElement | ts.JsxSelfClosingElement, name: string): ts.JsxAttribute | undefined {
  const opening = ts.isJsxElement(element) ? element.openingElement : element;
  return opening.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(source) === name);
}
const forms = nodes(source, ts.isJsxSelfClosingElement).filter((node) => node.tagName.getText(source) === "WorkOrderForm");

describe("WorkOrders lazy edit-form boundary", () => {
  it("uses one module-scope React.lazy factory and no eager import/preload", () => {
    const imports = nodes(source, ts.isImportDeclaration);
    expect(imports.some((item) => ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text === formPath)).toBe(false);
    expect(imports.some((item) => /\bWorkOrderForm\b/.test(item.importClause?.getText(source) || ""))).toBe(false);
    const declarations = source.statements.flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []);
    const declaration = declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === "WorkOrderForm");
    expect(declaration).toBeDefined();
    const initializer = declaration!.initializer;
    expect(initializer && ts.isCallExpression(initializer)).toBe(true);
    const lazyCall = initializer as ts.CallExpression;
    expect(lazyCall.expression.getText(source)).toBe("lazy");
    expect(ts.isArrowFunction(lazyCall.arguments[0])).toBe(true);
    const dynamicImports = nodes(source, ts.isCallExpression).filter((call) => call.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === formPath);
    expect(dynamicImports).toHaveLength(1);
    expect(nodes(lazyCall.arguments[0], ts.isCallExpression)).toContain(dynamicImports[0]);
    expect(source.text).not.toMatch(/WorkOrderForm\.(?:preload|load)\s*\(/);
  });

  it("keeps the form inside the closed edit dialog and an accessible Suspense fallback", () => {
    expect(forms).toHaveLength(1);
    const form = forms[0];
    const suspense = ancestor(form, "Suspense");
    const content = ancestor(form, "DialogContent");
    const dialog = ancestor(form, "Dialog");
    expect(suspense).toBeDefined();
    expect(content).toBeDefined();
    expect(dialog).toBeDefined();
    expect(ancestor(suspense!, "DialogContent")).toBe(content);
    expect(attribute(dialog!, "open")?.initializer?.getText(source)).toBe("{!!editOrder}");
    expect(attribute(content!, "forceMount")).toBeUndefined();
    expect(attribute(dialog!, "forceMount")).toBeUndefined();
    const fallback = attribute(suspense!, "fallback")?.initializer?.getText(source);
    expect(fallback).toContain('role="status"');
    expect(fallback).toContain('t("common.loading")');
  });

  it("preserves edit data, close and saved-list-refresh callbacks across the lazy boundary", () => {
    expect(forms).toHaveLength(1);
    const form = forms[0];
    expect(attribute(form, "initial")?.initializer?.getText(source)).toBe("{editOrder}");
    expect(attribute(form, "onClose")?.initializer?.getText(source)).toContain("setEditOrder(null)");
    const saved = attribute(form, "onSaved")?.initializer?.getText(source);
    expect(saved).toContain("setEditOrder(null)");
    expect(saved).toContain("workOrdersPageQuery.refetch()");
  });
});
