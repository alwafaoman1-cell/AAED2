import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Download, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { smartBack } from "@/lib/smartBack";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { useInsuranceInvoices } from "@/hooks/useInsuranceInvoices";
import { useClaimPayments } from "@/hooks/useClaimPayments";
import {
  buildInsuranceCollectionRows,
  exportInsuranceCollectionRowsToXlsx,
  formatOmr3,
  INSURANCE_COLLECTION_HEADERS,
} from "@/lib/insuranceCollectionReport";

export default function CompletedWithoutInvoice() {
  const navigate = useNavigate();
  const { data: claims = [], isLoading: claimsLoading, error: claimsError } = useInsuranceClaims();
  const { data: invoices = [], isLoading: invoicesLoading, error: invoicesError } = useInsuranceInvoices();
  const { data: payments = [], isLoading: paymentsLoading, error: paymentsError } = useClaimPayments();

  const loading = claimsLoading || invoicesLoading || paymentsLoading;
  const error = claimsError || invoicesError || paymentsError;

  const rows = useMemo(
    () => buildInsuranceCollectionRows({
      claims,
      invoices,
      payments,
      pendingCollectionOnly: true,
    }),
    [claims, invoices, payments],
  );

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    subtotal: acc.subtotal + row.approvedBeforeVat,
    vat: acc.vat + row.vatAmount,
    total: acc.total + row.totalIncludingVat,
    paid: acc.paid + row.paidAmount,
    remaining: acc.remaining + row.remainingAmount,
  }), { subtotal: 0, vat: 0, total: 0, paid: 0, remaining: 0 }), [rows]);

  const exportExcel = () => {
    try {
      exportInsuranceCollectionRowsToXlsx(
        rows,
        `Completed_Claims_Pending_Collection_${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
      toast.success("تم تصدير Excel");
    } catch (err: any) {
      toast.error(err?.message || "تعذر تصدير التقرير");
    }
  };

  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" className="gap-1 mb-2" onClick={() => smartBack(navigate, "/reports")}>
            <ArrowRight size={16} /> رجوع
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileWarning className="text-warning" /> مطالبات مكتملة وبانتظار التحصيل
          </h1>
          <p className="text-sm text-muted-foreground">
            يعرض فقط المطالبات المسلّمة فعليًا والتي لها فاتورة نهائية ورصيد متبقٍ غير محصل.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={exportExcel} disabled={loading || !!error || rows.length === 0}>
          <Download size={16} /> تصدير Excel
        </Button>
      </div>

      {error && (
        <Card className="p-4 border-destructive/40 text-destructive text-sm">
          تعذر تحميل بيانات التقرير. لا يتم إنشاء ملف Excel فارغ عند فشل الاستعلام.
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">عدد المطالبات</p>
          <p className="text-2xl font-bold">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">المعتمد قبل الضريبة</p>
          <p className="text-xl font-bold">{formatOmr3(totals.subtotal)} OMR</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">الضريبة 5%</p>
          <p className="text-xl font-bold">{formatOmr3(totals.vat)} OMR</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">الإجمالي شامل الضريبة</p>
          <p className="text-xl font-bold">{formatOmr3(totals.total)} OMR</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">الرصيد المتبقي</p>
          <p className="text-xl font-bold text-warning">{formatOmr3(totals.remaining)} OMR</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {INSURANCE_COLLECTION_HEADERS.map((header) => (
                  <TableHead key={header} className="whitespace-nowrap">{header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={INSURANCE_COLLECTION_HEADERS.length} className="py-10 text-center text-muted-foreground">
                    جاري تحميل التقرير...
                  </TableCell>
                </TableRow>
              ) : rows.length ? rows.map((row) => (
                <TableRow key={`${row.claimId}-${row.invoiceId}`}>
                  <TableCell className="font-mono text-xs">{row.claimNumber}</TableCell>
                  <TableCell className="font-mono text-xs">{row.vehicleNumber}</TableCell>
                  <TableCell>{row.vehicleMakeModel}</TableCell>
                  <TableCell>{row.customerName}</TableCell>
                  <TableCell dir="ltr">{row.estimateDate}</TableCell>
                  <TableCell dir="ltr">{row.workshopArrivalDate}</TableCell>
                  <TableCell dir="ltr">{row.workStartedAt}</TableCell>
                  <TableCell dir="ltr">{row.workCompletedAt}</TableCell>
                  <TableCell dir="ltr">{row.deliveredAt}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-pre-line">{row.invoiceDateNumber}</TableCell>
                  <TableCell>{row.workshopDays}</TableCell>
                  <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                  <TableCell dir="ltr">{formatOmr3(row.approvedBeforeVat)}</TableCell>
                  <TableCell dir="ltr">{formatOmr3(row.vatAmount)}</TableCell>
                  <TableCell dir="ltr" className="font-semibold">{formatOmr3(row.totalIncludingVat)}</TableCell>
                  <TableCell dir="ltr" className="text-success">{formatOmr3(row.paidAmount)}</TableCell>
                  <TableCell><Badge variant={row.collectionStatus === "مدفوع جزئيًا" ? "secondary" : "outline"}>{row.collectionStatus}</Badge></TableCell>
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={INSURANCE_COLLECTION_HEADERS.length} className="py-10 text-center text-muted-foreground">
                    لا توجد مطالبات مسلّمة ذات فاتورة ورصيد متبقٍ حاليًا.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
