import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

type Shortcut = { keys: string; label: string; action: () => void };

/**
 * Global keyboard shortcuts.
 * - "?" or Shift+/ → opens help dialog
 * - "g" then "w/i/s/c/d" → go to Work Orders / Insurance / Sales / Customers / Dashboard
 * - "n" then "w/i/c/q" → new Work Order / Invoice / Claim / Quote
 * - "/" → focus the first visible search input
 */
export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState<string | null>(null);

  const go = (path: string) => () => navigate(path);

  const shortcuts: Shortcut[] = [
    { keys: "?", label: "عرض هذه القائمة", action: () => setOpen(true) },
    { keys: "/", label: "التركيز على شريط البحث", action: () => {} },
    { keys: "g d", label: "لوحة التحكم", action: go("/") },
    { keys: "g w", label: "أوامر العمل", action: go("/work-orders") },
    { keys: "g i", label: "التأمين", action: go("/insurance") },
    { keys: "g s", label: "المبيعات", action: go("/sales") },
    { keys: "g c", label: "العملاء", action: go("/customers") },
    { keys: "g v", label: "السيارات", action: go("/vehicles") },
    { keys: "g a", label: "المحاسبة", action: go("/accounting") },
    { keys: "n w", label: "أمر عمل جديد", action: go("/work-orders?new=1") },
    { keys: "n i", label: "فاتورة جديدة", action: go("/sales/invoices/new") },
    { keys: "n q", label: "عرض سعر جديد", action: go("/sales/quotes/new") },
    { keys: "n c", label: "مطالبة جديدة", action: go("/insurance/new") },
  ];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editable = target?.isContentEditable;
      if (editable || tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Help
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOpen(true);
        return;
      }

      // Focus search
      if (e.key === "/") {
        const search =
          document.querySelector<HTMLInputElement>(
            'input[type="search"], input[placeholder*="بحث"], input[placeholder*="Search"]',
          );
        if (search) {
          e.preventDefault();
          search.focus();
        }
        return;
      }

      // Two-letter combos: g X / n X
      if (prefix) {
        const combo = `${prefix} ${e.key.toLowerCase()}`;
        const found = shortcuts.find((s) => s.keys === combo);
        setPrefix(null);
        if (found) {
          e.preventDefault();
          found.action();
        }
        return;
      }
      if (e.key === "g" || e.key === "n") {
        setPrefix(e.key);
        // auto-clear if no follow-up within 1.2s
        window.setTimeout(() => setPrefix((p) => (p === e.key ? null : p)), 1200);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" /> اختصارات لوحة المفاتيح
          </DialogTitle>
          <DialogDescription>
            استخدم هذه الاختصارات للتنقل السريع داخل النظام.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 mt-2">
          {shortcuts.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between text-sm border-b border-border/50 py-1.5"
            >
              <span className="text-muted-foreground">{s.label}</span>
              <kbd className="px-2 py-0.5 rounded bg-muted text-foreground font-mono text-xs border border-border">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
