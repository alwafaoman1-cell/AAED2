import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Receipt, Calendar, User, Wallet, Tag, FileText, Package, ImageIcon, Building2, Hash } from "lucide-react";
import type { ExpenseRecord } from "@/lib/expensesStore";

interface Props {
  expense: ExpenseRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const Row = ({ icon: Icon, label, value, mono = false }: any) => {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-[120px]">
        {Icon && <Icon size={12} />}
        <span>{label}</span>
      </div>
      <div className={`text-sm text-foreground font-medium text-right ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
};

export default function ExpensePreviewDialog({ expense, open, onOpenChange }: Props) {
  if (!expense) return null;

  const partProfit =
    expense.partName && expense.partQty && expense.unitSellPrice != null && expense.unitBuyPrice != null
      ? (expense.unitSellPrice - expense.unitBuyPrice) * expense.partQty
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt size={18} className="text-warning" />
            معاينة سند الصرف
            <Badge variant="outline" className="font-mono text-xs">{expense.voucherNumber}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Amount banner */}
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 text-center">
            <p className="text-[11px] text-muted-foreground mb-1">إجمالي السند</p>
            <p className="text-2xl font-bold text-warning">
              {Number(expense.amount).toLocaleString()} <span className="text-sm">ر.ع</span>
            </p>
          </div>

          {/* Main info */}
          <div className="bg-card border border-border rounded-lg p-3">
            <Row icon={Calendar} label="التاريخ" value={expense.date} />
            <Row icon={Tag} label="التصنيف" value={expense.categoryName || "—"} />
            <Row icon={FileText} label="اسم المصروف / الوصف" value={expense.description || expense.categoryName || "—"} />
            <Row icon={User} label="المستفيد" value={expense.beneficiary || "—"} />
            <Row icon={Wallet} label="الخزينة" value={expense.cashboxName || "—"} />
            <Row icon={Hash} label="طريقة الدفع" value={expense.paymentMethod} />
          </div>

          {/* Supplier info */}
          {(expense.supplierTaxNumber || expense.supplierInvoiceNumber) && (
            <div className="bg-info/5 border border-info/20 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-info mb-2 flex items-center gap-1">
                <Building2 size={12} /> بيانات المورد
              </h4>
              <Row icon={Hash} label="الرقم الضريبي" value={expense.supplierTaxNumber} mono />
              <Row icon={FileText} label="رقم فاتورة المورد" value={expense.supplierInvoiceNumber} mono />
            </div>
          )}

          {/* Parts info */}
          {expense.partName && (
            <div className="bg-success/5 border border-success/20 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-success mb-2 flex items-center gap-1">
                <Package size={12} /> تفاصيل قطعة الغيار
              </h4>
              <Row icon={Package} label="اسم القطعة" value={expense.partName} />
              <Row icon={Hash} label="رقم القطعة" value={expense.partNumber} mono />
              <Row icon={Hash} label="الكمية" value={expense.partQty} />
              <Row icon={Hash} label="سعر الشراء/الوحدة" value={expense.unitBuyPrice != null ? `${expense.unitBuyPrice.toFixed(3)} ر.ع` : undefined} />
              <Row icon={Hash} label="سعر البيع/الوحدة" value={expense.unitSellPrice != null ? `${expense.unitSellPrice.toFixed(3)} ر.ع` : undefined} />
              {partProfit != null && (
                <div className="mt-2 pt-2 border-t border-success/20 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">الربح المتوقع</span>
                  <span className={`text-sm font-bold ${partProfit >= 0 ? "text-success" : "text-destructive"}`}>
                    {partProfit.toFixed(3)} ر.ع
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Photo */}
          {expense.photo && (
            <div className="bg-card border border-border rounded-lg p-3">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1 text-muted-foreground">
                <ImageIcon size={12} /> صورة الإيصال
              </h4>
              <a href={expense.photo} target="_blank" rel="noreferrer">
                <img
                  src={expense.photo}
                  alt="إيصال"
                  className="max-h-72 w-full object-contain rounded border border-border hover:opacity-90 transition"
                />
              </a>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
