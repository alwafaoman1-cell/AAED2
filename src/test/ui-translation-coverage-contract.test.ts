import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { AR_TO_EN, translateAr } from "@/i18n/autoDictionary";

const root = process.cwd();
const hasArabic = (value: string) => /[\u0600-\u06ff]/.test(value);

function tsxFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = resolve(directory, name);
    if (statSync(file).isDirectory()) return tsxFiles(file);
    return file.endsWith(".tsx") ? [file] : [];
  });
}

function visibleArabicLiterals(file: string): string[] {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values: string[] = [];
  const add = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized && hasArabic(normalized)) values.push(normalized);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node.text);
    if (ts.isJsxAttribute(node) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) add(node.initializer.text);
      if (
        ts.isJsxExpression(node.initializer)
        && node.initializer.expression
        && ts.isStringLiteral(node.initializer.expression)
      ) {
        add(node.initializer.expression.text);
      }
    }
    if (
      ts.isJsxExpression(node)
      && node.expression
      && ts.isStringLiteral(node.expression)
    ) {
      add(node.expression.text);
    }
    if (ts.isStringLiteral(node)) {
      let parent: ts.Node | undefined = node.parent;
      while (parent) {
        if (ts.isJsxElement(parent)) {
          const tag = parent.openingElement.tagName.getText(source);
          if (tag === "button" || tag === "Button" || tag.endsWith("Button")) {
            add(node.text);
          }
          break;
        }
        parent = parent.parent;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

describe("production UI translation coverage", () => {
  it("covers every static Arabic JSX label and visible attribute", () => {
    const missing = new Set<string>();
    for (const file of tsxFiles(resolve(root, "src"))) {
      for (const value of visibleArabicLiterals(file)) {
        if (!AR_TO_EN[value]) missing.add(value);
      }
    }
    expect([...missing], `Missing English UI translations:\n${[...missing].join("\n")}`).toEqual([]);
  }, 20_000);

  it("keeps English translations English-only", () => {
    const invalid = Object.entries(AR_TO_EN)
      .filter(([, value]) => hasArabic(value))
      .map(([key]) => key);
    expect(invalid, `Arabic leaked into English translations:\n${invalid.join("\n")}`).toEqual([]);
  });

  it("translates common actions without changing unknown business data", () => {
    expect(translateAr("حذف")).toBe("Delete");
    expect(translateAr("تعديل")).toBe("Edit");
    expect(translateAr("رجوع")).toBe("Back");
    expect(translateAr("اعتماد المطالبة")).toBe("Approve Claim");
    expect(translateAr("CUSTOMER-001")).toBe("CUSTOMER-001");
  });

  it("keeps the production translator bounded and React-safe", () => {
    const translator = readFileSync(resolve(root, "src/i18n/autoTranslate.ts"), "utf8");
    expect(translator).not.toContain("import.meta.env.DEV");
    expect(translator).toContain("new WeakMap<Text, string>()");
    expect(translator).toContain("window.requestAnimationFrame");
    expect(translator).toContain("if (observer) return");
    expect(translator).toContain("observer.disconnect()");
    expect(translator).toContain('[translate="no"]');
    expect(translator).toContain("[data-no-translate]");
    expect(translator).toContain("[data-pdf-layout]");
    expect(translator).not.toContain("innerHTML");
    expect(translator).not.toContain("createElement");
  });
});
