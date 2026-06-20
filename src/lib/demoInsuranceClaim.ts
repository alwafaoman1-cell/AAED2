// إنشاء مطالبة تجريبية مرتبطة بأمر عمل — للمستخدمين الجدد
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addWorkOrder, type WorkOrder } from "./workOrdersStore";
import { findOrCreateInsuranceCompany } from "@/hooks/useInsuranceCompanies";

export async function createDemoClaim(): Promise<string | null> {
  const { data: tenant } = await supabase.rpc("get_user_tenant_id");
  if (!tenant) { toast.error("لم يتم التعرف على الورشة"); return null; }
  const tenantId = tenant as string;

  // 1) عميل تجريبي
  const demoName = "عميل تجريبي - مطالبة تأمين";
  let { data: customer } = await supabase
    .from("customers").select("id").eq("tenant_id", tenantId).eq("name", demoName).maybeSingle();
  if (!customer) {
    const { data: newC, error } = await supabase
      .from("customers").insert({ tenant_id: tenantId, name: demoName, phone: "+96890000000" })
      .select("id").single();
    if (error) { toast.error(error.message); return null; }
    customer = newC;
  }

  // 2) سيارة تجريبية
  let { data: vehicle } = await supabase
    .from("vehicles").select("id, plate_number, brand, model, year")
    .eq("customer_id", customer!.id).maybeSingle();
  if (!vehicle) {
    const { data: newV, error } = await supabase
      .from("vehicles").insert({
        tenant_id: tenantId, customer_id: customer!.id,
        plate_number: "DEMO-1234", brand: "تويوتا", model: "كامري", year: 2022, color: "أبيض",
      }).select("id, plate_number, brand, model, year").single();
    if (error) { toast.error(error.message); return null; }
    vehicle = newV;
  }

  // 3) شركة تأمين
  const companyId = await findOrCreateInsuranceCompany("شركة تأمين تجريبية", tenantId);

  // 4) المطالبة
  const claimNumber = `DEMO-${Date.now().toString().slice(-5)}`;
  const { data: claim, error } = await supabase
    .from("insurance_claims" as any).insert({
      tenant_id: tenantId,
      customer_id: customer!.id,
      vehicle_id: vehicle!.id,
      claim_number: claimNumber,
      insurance_company: "شركة تأمين تجريبية",
      insurance_company_id: companyId,
      estimated_amount: 850, estimated_cost: 850,
      vehicle_owner_name: demoName, vehicle_owner_phone: "+96890000000",
      notes: "مطالبة تجريبية أُنشئت تلقائياً للتجربة",
      damage_photos: [], documents: [], needed_parts: [
        { name: "صدام أمامي", quantity: 1, notes: "بحاجة استبدال" },
        { name: "مصباح أيمن", quantity: 1 },
      ],
    } as any).select("id").single();
  if (error) { toast.error(error.message); return null; }

  // 5) أمر عمل تجريبي مرتبط
  const woId = `WO-DEMO-${Date.now().toString().slice(-5)}`;
  const wo: WorkOrder = {
    id: woId, customer: "شركة تأمين تجريبية", phone: "+96890000000",
    plate: vehicle!.plate_number, vehicleType: vehicle!.brand, model: vehicle!.model,
    year: String(vehicle!.year ?? ""), vin: "", insurance: "شركة تأمين تجريبية",
    claimNumber, entryDate: new Date().toISOString().slice(0, 10),
    technician: "", serviceType: "إصلاح تأمين", status: "بانتظار قطع الغيار",
    totalCost: 850, laborCost: 300, partsCost: 550,
    description: `مطالبة تجريبية ${claimNumber} مرتبطة بأمر العمل ${woId}`,
    partsNeeded: [
      { id: `${woId}-p1`, name: "صدام أمامي", quantity: 1, status: "pending" },
      { id: `${woId}-p2`, name: "مصباح أيمن", quantity: 1, status: "pending" },
    ],
  };
  addWorkOrder(wo);

  toast.success(`تم إنشاء المطالبة ${claimNumber} وأمر العمل ${woId}`);
  return (claim as any).id;
}
