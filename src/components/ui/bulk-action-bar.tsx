// شريط الإجراءات الجماعية — يظهر أسفل الشاشة عند تحديد عناصر متعددة.
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  children: ReactNode;
  label?: string;
}

export function BulkActionBar({ count, onClear, children, label = "محدد" }: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-card border border-border rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
      <span className="text-sm font-semibold">
        <span className="text-primary font-mono">{count}</span> {label}
      </span>
      <div className="h-6 w-px bg-border" />
      <div className="flex items-center gap-2">{children}</div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear} title="إلغاء التحديد">
        <X size={14} />
      </Button>
    </div>
  );
}
