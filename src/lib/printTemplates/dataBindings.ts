// Resolve {{placeholders}} from template props against runtime data
import { toEnglishDigits } from "@/lib/numberUtils";

const get = (obj: any, path: string): any => {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
};

export function bind(template: string | undefined, data: any): string {
  if (!template) return "";
  const resolved = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = get(data, key);
    if (v === undefined || v === null || v === "") return "";
    return String(v);
  });
  return toEnglishDigits(resolved);
}

export const escapeHtml = (s: any): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
