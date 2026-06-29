import { useState } from "react";
import { Mail, Phone, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useCreateInsuranceEmployee,
  useInsuranceEmployees,
  useUpdateInsuranceEmployee,
  type InsuranceEmployee,
} from "@/hooks/useInsuranceEmployees";

interface Props {
  companyId: string;
}

const emptyForm = {
  name: "",
  title: "",
  email: "",
  phone: "",
};

export default function InsuranceEmployeesManager({ companyId }: Props) {
  const { data: employees = [], isLoading } = useInsuranceEmployees(companyId, true);
  const createEmployee = useCreateInsuranceEmployee();
  const updateEmployee = useUpdateInsuranceEmployee();
  const [form, setForm] = useState(emptyForm);

  const canCreate = form.name.trim().length > 1;

  function addEmployee() {
    if (!canCreate) return;
    createEmployee.mutate({
      insurance_company_id: companyId,
      name: form.name,
      title: form.title,
      email: form.email,
      phone: form.phone,
      is_active: true,
    }, {
      onSuccess: () => setForm(emptyForm),
    });
  }

  function toggleActive(employee: InsuranceEmployee) {
    updateEmployee.mutate({
      id: employee.id,
      updates: { is_active: !employee.is_active },
    });
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">موظفو شركة التأمين</h2>
          <p className="text-xs text-muted-foreground">اربط المطالبات بموظف محدد داخل الشركة لتسهيل المتابعة والفلترة.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div className="space-y-1 md:col-span-2">
          <Label>اسم الموظف</Label>
          <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="مثال: أحمد سالم" />
        </div>
        <div className="space-y-1">
          <Label>الوظيفة</Label>
          <Input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="Claims Officer" />
        </div>
        <div className="space-y-1">
          <Label>البريد</Label>
          <Input value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="name@company.com" dir="ltr" />
        </div>
        <Button type="button" onClick={addEmployee} disabled={!canCreate || createEmployee.isPending} className="gap-2">
          <Plus size={14} /> إضافة
        </Button>
        <div className="space-y-1 md:col-span-2">
          <Label>الهاتف</Label>
          <Input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="+968..." dir="ltr" />
        </div>
      </div>

      <div className="border rounded-lg divide-y">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground text-center">جاري تحميل الموظفين...</div>
        ) : employees.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">لا يوجد موظفون بعد.</div>
        ) : employees.map((employee) => (
          <div key={employee.id} className="p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{employee.name}</span>
                {employee.title && <span className="text-xs text-muted-foreground">— {employee.title}</span>}
                {!employee.is_active && <span className="text-xs rounded-full bg-muted px-2 py-0.5">غير نشط</span>}
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {employee.email && <span className="inline-flex items-center gap-1" dir="ltr"><Mail size={12} />{employee.email}</span>}
                {employee.phone && <span className="inline-flex items-center gap-1" dir="ltr"><Phone size={12} />{employee.phone}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">نشط</span>
              <Switch checked={employee.is_active} onCheckedChange={() => toggleActive(employee)} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => updateEmployee.mutate({ id: employee.id, updates: { ...employee } })}
                disabled={updateEmployee.isPending}
              >
                <Save size={12} /> حفظ
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
