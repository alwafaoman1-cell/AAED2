import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UnifiedInvoiceSearchResult } from "@/lib/unifiedInvoiceSearch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: UnifiedInvoiceSearchResult[];
  onOpenResult: (result: UnifiedInvoiceSearchResult) => void;
  isAr: boolean;
}
const sourceLabel = (result: UnifiedInvoiceSearchResult, isAr: boolean) => {
  if (result.source_type === "sales_documents") return isAr ? "فاتورة كاش" : "Cash invoice";
  if (result.source_type === "insurance_invoices") return isAr ? "فاتورة تأمين" : "Insurance invoice";
  return isAr ? "فاتورة قديمة" : "Legacy invoice";
};

export default function UnifiedInvoiceSearchResultsDialog({
  open,
  onOpenChange,
  results,
  onOpenResult,
  isAr,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isAr ? "نتائج رقم الفاتورة" : "Invoice number results"}</DialogTitle>
          <DialogDescription>
            {isAr
              ? "هذا رقم تاريخي مكرر. اختر السجل الصحيح حسب النوع والتاريخ."
              : "This historical number has multiple matches. Select by source and date."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {results.map((result) => (
            <button
              key={`${result.source_type}:${result.source_id}`}
              type="button"
              className="w-full rounded-lg border p-3 text-start hover:border-primary hover:bg-muted/40"
              onClick={() => onOpenResult(result)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-semibold">{result.invoice_number}</span>
                <span className="text-xs text-muted-foreground">{sourceLabel(result, isAr)}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {result.invoice_date || (isAr ? "بدون تاريخ" : "No date")}
                {result.is_historical ? ` · ${isAr ? "تاريخية" : "Historical"}` : ""}
              </div>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isAr ? "إغلاق" : "Close"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
