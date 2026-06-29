import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInsuranceEmployees } from "@/hooks/useInsuranceEmployees";

interface Props {
  companyId?: string | null;
  value?: string | null;
  onChange: (employeeId: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

const NONE = "__none__";

export default function InsuranceEmployeeSelect({
  companyId,
  value,
  onChange,
  placeholder = "اختر موظف التأمين",
  disabled,
}: Props) {
  const { data: employees = [], isLoading } = useInsuranceEmployees(companyId || null);
  return (
    <Select
      value={value || NONE}
      disabled={disabled || !companyId || isLoading}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>بدون موظف محدد</SelectItem>
        {employees.map((employee) => (
          <SelectItem key={employee.id} value={employee.id}>
            {employee.name}
            {employee.title ? ` — ${employee.title}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
