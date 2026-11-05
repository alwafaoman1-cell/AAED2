import { useState, useMemo, useId, useEffect, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Building2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";

interface Props {
  value: string; // company name (text shown)
  companyId: string | null;
  onChange: (name: string, companyId: string | null) => void;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/** حقل ذكي: يبحث في شركات التأمين المسجلة فقط (لا يسمح بالإنشاء من هنا).
 *  لإضافة شركة جديدة، استخدم صفحة "شركات التأمين". */
export default function InsuranceCompanyAutocomplete({
  value,
  companyId,
  onChange,
  placeholder,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: Props) {
  const generatedId = useId();
  const listId = `${generatedId}-companies`;
  const { i18n } = useTranslation();
  const isEnglish = (i18n.resolvedLanguage || i18n.language || "ar").startsWith("en");
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: companies, isLoading } = useInsuranceCompanies(open || !!companyId);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return companies?.slice(0, 8) ?? [];
    return (companies ?? []).filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [companies, value]);

  const activeIndex = filtered.findIndex((company) => company.id === activeId);
  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, listId]);

  function chooseCompany(company: { id: string; name: string }) {
    onChange(company.name, company.id);
    setOpen(false);
    setActiveId(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || (open && (event.key === "Home" || event.key === "End"))) {
      event.preventDefault();
      setOpen(true);
      if (!filtered.length) return;
      const next = event.key === "Home" ? 0
        : event.key === "End" ? filtered.length - 1
        : event.key === "ArrowDown" ? (activeIndex + 1) % filtered.length
        : activeIndex < 0 ? filtered.length - 1 : (activeIndex - 1 + filtered.length) % filtered.length;
      setActiveId(filtered[next].id);
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      chooseCompany(filtered[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActiveId(null);
    }
  }

  const exactMatch = useMemo(() => {
    return (companies ?? []).find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
  }, [companies, value]);

  return (
    <div dir={isEnglish ? "ltr" : "rtl"} className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setOpen(false);
        setActiveId(null);
      }
    }}>
      <Input
        id={id || generatedId}
        role="combobox"
        aria-label={ariaLabel || (isEnglish ? "Insurance company" : "شركة التأمين")}
        aria-labelledby={ariaLabelledBy}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          // نسمح فقط بالكتابة للبحث؛ لا نُثبّت اسم خارج القائمة
          onChange(e.target.value, null);
          setActiveId(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? (isEnglish ? "Search registered insurance companies…" : "ابحث عن شركة تأمين مسجلة...")}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          <div id={listId} role="listbox" aria-label={isEnglish ? "Insurance companies" : "شركات التأمين"}>
            {filtered.map((c, index) => (
              <button
                key={c.id}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={c.id === activeId}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onPointerMove={() => setActiveId(c.id)}
                onClick={() => chooseCompany(c)}
                className={`ui-touch-target min-h-11 w-full flex items-center gap-2 px-3 py-2 text-sm text-start hover:bg-accent hover:text-accent-foreground ${c.id === activeId ? "bg-accent text-accent-foreground" : ""}`}
              >
                <Building2 size={14} className="text-muted-foreground" aria-hidden="true" />
                <div className="flex-1">
                  <div className="font-medium">{c.name}</div>
                  {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                </div>
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <div role="status" className="px-3 py-2 text-sm text-muted-foreground text-start">
              {isLoading ? (isEnglish ? "Loading companies…" : "جارٍ تحميل الشركات…") : (isEnglish ? "No matching company" : "لا توجد شركة مطابقة")}
            </div>
          )}
          {value.trim() && !exactMatch && (
            <Link
              to="/insurance/companies"
              onMouseDown={(e) => e.preventDefault()}
              className="ui-touch-target min-h-11 w-full flex items-center gap-2 px-3 py-2 text-xs text-start text-primary hover:bg-accent hover:text-accent-foreground border-t border-border"
            >
              <Info size={14} aria-hidden="true" />
              {isEnglish ? "To add a company, open Insurance companies" : "لإضافة شركة جديدة، انتقل إلى صفحة شركات التأمين"}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
