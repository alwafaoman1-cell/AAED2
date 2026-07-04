import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateClaimStatus, InsuranceClaim } from "@/hooks/useInsuranceClaims";
import { CheckCircle, XCircle, DollarSign } from "lucide-react";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: InsuranceClaim | null;
}

export default function ClaimStatusDialog({ open, onOpenChange, claim }: Props) {
  const [approvedAmount, setApprovedAmount] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const updateStatus = useUpdateClaimStatus();

  if (!claim) return null;

  const handleAction = (status: "approved" | "rejected" | "paid") => {
    updateStatus.mutate(
      {
        id: claim.id,
        status,
        approved_amount: status === "approved" ? parseMoneyInput(approvedAmount || String(claim.estimated_amount)) : undefined,
        rejection_reason: status === "rejected" ? rejectionReason : undefined,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تحديث حالة المطالبة - {claim.claim_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-secondary/30 rounded-lg p-3 text-sm space-y-1">
            <p><span className="text-muted-foreground">شركة التأمين:</span> {claim.insurance_company}</p>
            <p><span className="text-muted-foreground">المبلغ المقدر:</span> {claim.estimated_amount?.toLocaleString()} ر.ع</p>
            <p><span className="text-muted-foreground">الحالة الحالية:</span> {statusLabels[claim.status]}</p>
          </div>

          {claim.status === "pending" && (
            <>
              <div className="space-y-1.5">
                <Label>المبلغ المعتمد (ر.ع)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={approvedAmount}
                  onChange={(e) => setApprovedAmount(e.target.value)}
                  placeholder={String(claim.estimated_amount)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>سبب الرفض (في حالة الرفض)</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="سبب رفض المطالبة..."
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleAction("approved")}
                  disabled={updateStatus.isPending}
                  className="flex-1 bg-success hover:bg-success/90"
                >
                  <CheckCircle size={16} className="ml-1" />
                  قبول
                </Button>
                <Button
                  onClick={() => handleAction("rejected")}
                  disabled={updateStatus.isPending}
                  variant="destructive"
                  className="flex-1"
                >
                  <XCircle size={16} className="ml-1" />
                  رفض
                </Button>
              </div>
            </>
          )}

          {claim.status === "approved" && (
            <Button
              onClick={() => handleAction("paid")}
              disabled={updateStatus.isPending}
              className="w-full"
            >
              <DollarSign size={16} className="ml-1" />
              تأكيد الدفع
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const statusLabels: Record<string, string> = {
  pending: "بانتظار الموافقة",
  approved: "مقبولة",
  rejected: "مرفوضة",
  paid: "مدفوعة",
};
