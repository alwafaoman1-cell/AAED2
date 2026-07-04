import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCustomers, useVehiclesByCustomer, useJobOrders, useCreateClaim } from "@/hooks/useInsuranceClaims";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import { supabase } from "@/integrations/supabase/client";
import { isUuid } from "@/lib/uuid";
import { Link } from "react-router-dom";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ClaimFormDialog({ open, onOpenChange }: Props) {
  const [customerId, setCustomerId] = useState<string>("");
  const [vehicleId, setVehicleId] = useState<string>("");
  const [jobOrderId, setJobOrderId] = useState<string>("");
  const [claimNumber, setClaimNumber] = useState("");
  const [company, setCompany] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const { data: customers } = useCustomers();
  const { data: vehicles } = useVehiclesByCustomer(customerId || null);
  const { data: jobOrders } = useJobOrders();
  const { data: insuranceCompanies } = useInsuranceCompanies();
  const createClaim = useCreateClaim();

  // Filter job orders by selected customer
  const filteredOrders = jobOrders?.filter(
    (o) => o.customer_id === customerId && o.vehicle_id === vehicleId
  ) ?? [];

  useEffect(() => {
    setVehicleId("");
    setJobOrderId("");
  }, [customerId]);

  const handleSubmit = async () => {
    if (!customerId || !vehicleId || !jobOrderId || !claimNumber || !company || !amount) return;
    if (!isUuid(customerId) || !isUuid(vehicleId) || !isUuid(jobOrderId)) {
      throw new Error("Customer, vehicle, and work order must be saved before creating the claim.");
    }

    // Get tenant_id
    const { data: profile } = await supabase.rpc("get_user_tenant_id");
    if (!profile) return;

    createClaim.mutate(
      {
        tenant_id: profile as string,
        customer_id: customerId,
        vehicle_id: vehicleId,
        job_order_id: jobOrderId,
        claim_number: claimNumber,
        insurance_company: company,
        estimated_amount: parseMoneyInput(amount),
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      }
    );
  };

  const resetForm = () => {
    setCustomerId("");
    setVehicleId("");
    setJobOrderId("");
    setClaimNumber("");
    setCompany("");
    setAmount("");
    setNotes("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>مطالبة تأمين جديدة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Customer */}
          <div className="space-y-1.5">
            <Label>العميل</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
              <SelectContent>
                {customers?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vehicle */}
          <div className="space-y-1.5">
            <Label>السيارة</Label>
            <Select value={vehicleId} onValueChange={setVehicleId} disabled={!customerId}>
              <SelectTrigger><SelectValue placeholder="اختر السيارة" /></SelectTrigger>
              <SelectContent>
                {vehicles?.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.brand} {v.model} - {v.plate_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Job Order */}
          <div className="space-y-1.5">
            <Label>أمر العمل</Label>
            <Select value={jobOrderId} onValueChange={setJobOrderId} disabled={!vehicleId}>
              <SelectTrigger><SelectValue placeholder="اختر أمر العمل" /></SelectTrigger>
              <SelectContent>
                {filteredOrders.length > 0 ? filteredOrders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.order_number}</SelectItem>
                )) : (
                  jobOrders?.filter(o => o.customer_id === customerId).map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.order_number}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Claim Number */}
            <div className="space-y-1.5">
              <Label>رقم المطالبة</Label>
              <Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} placeholder="CLM-001" />
            </div>

            {/* Insurance Company */}
            <div className="space-y-1.5">
              <Label>شركة التأمين</Label>
              <Select value={company} onValueChange={setCompany} disabled={!insuranceCompanies?.length}>
                <SelectTrigger>
                  <SelectValue placeholder={insuranceCompanies?.length ? "اختر الشركة" : "لا توجد شركات مسجلة"} />
                </SelectTrigger>
                <SelectContent>
                  {insuranceCompanies?.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!insuranceCompanies?.length && (
                <Link to="/insurance/companies" className="text-xs text-primary hover:underline">
                  + أضف شركة تأمين من صفحة الشركات
                </Link>
              )}
            </div>
          </div>

          {/* Estimated Amount */}
          <div className="space-y-1.5">
            <Label>المبلغ المقدر (ر.ع)</Label>
            <Input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات إضافية..." rows={3} />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={createClaim.isPending || !customerId || !vehicleId || !jobOrderId || !claimNumber || !company || !amount}
            className="w-full"
          >
            {createClaim.isPending ? "جاري الإنشاء..." : "إنشاء المطالبة"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
