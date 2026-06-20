import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Building2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";

interface Props {
  value: string; // company name (text shown)
  companyId: string | null;
  onChange: (name: string, companyId: string | null) => void;
  placeholder?: string;
}

/** حقل ذكي: يبحث في شركات التأمين المسجلة فقط (لا يسمح بالإنشاء من هنا).
 *  لإضافة شركة جديدة، استخدم صفحة "شركات التأمين". */
export default function InsuranceCompanyAutocomplete({
  value,
  companyId,
  onChange,
  placeholder,
}: Props) {
  const { data: companies } = useInsuranceCompanies();
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return companies?.slice(0, 8) ?? [];
    return (companies ?? []).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [companies, value]);

  const exactMatch = useMemo(() => {
    return (companies ?? []).find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
  }, [companies, value]);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          // نسمح فقط بالكتابة للبحث؛ لا نُثبّت اسم خارج القائمة
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder ?? "ابحث عن شركة تأمين مسجلة..."}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(c.name, c.id);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-right hover:bg-accent"
              >
                <Building2 size={14} className="text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium">{c.name}</div>
                  {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground text-right">
              لا توجد شركة مطابقة
            </div>
          )}
          {value.trim() && !exactMatch && (
            <Link
              to="/insurance/companies"
              onMouseDown={(e) => e.preventDefault()}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-right text-primary hover:bg-accent border-t border-border"
            >
              <Info size={12} />
              لإضافة شركة جديدة، انتقل إلى صفحة "شركات التأمين"
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
