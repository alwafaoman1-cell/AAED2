import { useEffect, useId, useMemo, useState } from "react";
import { Building2, Loader2, Plus, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { suppliersStore, type Supplier } from "@/lib/suppliersStore";
import i18n from "@/i18n";
import "@/lib/i18n/expenseEntryForm";
import type { ExpenseEntryFormKey } from "@/lib/i18n/expenseEntryForm";

export interface SupplierOption {
  id: string;
  name: string;
  phone?: string | null;
  taxNumber?: string | null;
  category?: string | null;
  notes?: string | null;
  vehicleBrands?: string[];
  source: "table" | "legacy";
}

interface SupplierPickerProps {
  supplierId?: string;
  supplierName?: string;
  taxNumber?: string;
  label?: string;
  placeholder?: string;
  onChange: (supplier: { id: string; name: string; taxNumber?: string | null }) => void;
  onClear?: () => void;
}

function normalize(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function cleanOrFilterValue(value: string): string {
  return value.replace(/[%_,]/g, "").trim();
}

function mapTableSupplier(row: any): SupplierOption {
  return {
    id: row.id,
    name: row.name || "",
    phone: row.phone || "",
    taxNumber: row.tax_number || "",
    category: row.category || "",
    notes: row.notes || "",
    vehicleBrands: Array.isArray(row.vehicle_brands) ? row.vehicle_brands : [],
    source: "table",
  };
}

function mapLegacySupplier(row: Supplier): SupplierOption {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    taxNumber: row.taxNumber,
    category: row.category,
    notes: row.notes,
    vehicleBrands: row.vehicleBrands || [],
    source: "legacy",
  };
}

async function loadTableSuppliers(search: string, supplierId?: string): Promise<SupplierOption[]> {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return [];

  const term = cleanOrFilterValue(search);
  let query = (supabase.from("suppliers") as any)
    .select("id,name,phone,email,tax_number,category,notes,vehicle_brands,is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (term.length >= 2) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,tax_number.ilike.%${term}%,category.ilike.%${term}%`);
  } else if (supplierId) {
    query = query.eq("id", supplierId);
  } else {
    return [];
  }

  const { data, error } = await query.order("name", { ascending: true }).limit(20);

  if (error) {
    throw error;
  }

  return (data || []).map(mapTableSupplier);
}

async function findTableDuplicate(input: { name: string; phone?: string; taxNumber?: string }) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error(i18n.t("expenseEntryForm.pickerTenantUnavailable"));

  const name = input.name.trim();
  const phone = input.phone?.trim();
  const taxNumber = input.taxNumber?.trim();

  let query = (supabase.from("suppliers") as any)
    .select("id,name,phone,tax_number,category,notes,vehicle_brands,is_active")
    .eq("tenant_id", tenantId)
    .limit(10);

  const filters = [`name.ilike.${cleanOrFilterValue(name)}`];
  if (phone) filters.push(`phone.eq.${cleanOrFilterValue(phone)}`);
  if (taxNumber) filters.push(`tax_number.eq.${cleanOrFilterValue(taxNumber)}`);
  query = query.or(filters.join(","));

  const { data, error } = await query;
  if (error) throw error;

  const normalizedName = normalize(name);
  const normalizedPhone = normalize(phone);
  const normalizedTax = normalize(taxNumber);

  return ((data || []) as any[]).find((row) => (
    normalize(row.name) === normalizedName ||
    (!!normalizedPhone && normalize(row.phone) === normalizedPhone) ||
    (!!normalizedTax && normalize(row.tax_number) === normalizedTax)
  ));
}

function parseVehicleBrands(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[,،؛;|\n]+/)
      .map((brand) => brand.trim())
      .filter(Boolean),
  ));
}

async function ensureTableSupplier(input: {
  name: string;
  phone?: string;
  taxNumber?: string;
  category?: string;
  vehicleBrands?: string[];
}) {
  const tenantId = await getCurrentTenantId();
  if (!tenantId) throw new Error(i18n.t("expenseEntryForm.pickerTenantUnavailable"));

  const duplicate = await findTableDuplicate(input);
  const requestedBrands = Array.from(new Set((input.vehicleBrands || []).map((brand) => brand.trim()).filter(Boolean)));
  if (duplicate?.id) {
    const currentBrands = Array.isArray(duplicate.vehicle_brands) ? duplicate.vehicle_brands : [];
    const mergedBrands = Array.from(new Set([...currentBrands, ...requestedBrands]));
    if (mergedBrands.length !== currentBrands.length) {
      const { data, error } = await (supabase.from("suppliers") as any)
        .update({ vehicle_brands: mergedBrands })
        .eq("tenant_id", tenantId)
        .eq("id", duplicate.id)
        .select("id,name,phone,tax_number,category,notes,vehicle_brands,is_active")
        .single();
      if (error) throw error;
      return mapTableSupplier(data);
    }
    return mapTableSupplier(duplicate);
  }

  const { data, error } = await (supabase.from("suppliers") as any)
    .insert({
      tenant_id: tenantId,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      tax_number: input.taxNumber?.trim() || null,
      category: input.category || "مصروفات",
      vehicle_brands: requestedBrands,
      notes: "Added from expense supplier picker",
      is_active: true,
    })
    .select("id,name,phone,tax_number,category,notes,vehicle_brands,is_active")
    .single();

  if (error) throw error;
  return mapTableSupplier(data);
}

function syncLegacySupplier(selected: SupplierOption) {
  const duplicate = suppliersStore.getAll().find((supplier) =>
    supplier.id === selected.id ||
    normalize(supplier.name) === normalize(selected.name) ||
    (!!selected.phone && normalize(supplier.phone) === normalize(selected.phone)) ||
    (!!selected.taxNumber && normalize(supplier.taxNumber) === normalize(selected.taxNumber))
  );

  const payload = {
    id: selected.id,
    name: selected.name,
    phone: selected.phone || "",
    taxNumber: selected.taxNumber || undefined,
    category: selected.category || "مصروفات",
    notes: selected.notes || "",
    vehicleBrands: selected.vehicleBrands || [],
  };

  if (duplicate) {
    suppliersStore.update(duplicate.id, payload as any);
  } else {
    suppliersStore.add({ ...payload, createdAt: new Date().toISOString() });
  }
}

export default function SupplierPicker({
  supplierId,
  supplierName,
  taxNumber,
  label,
  placeholder,
  onChange,
  onClear,
}: SupplierPickerProps) {
  const { t: translate, i18n: language } = useTranslation();
  const t = (key: ExpenseEntryFormKey, values?: Record<string, unknown>) => translate("expenseEntryForm." + key, values);
  const isAr = language.language?.startsWith("ar");
  const id = useId();
  const inputId = (field: string) => id + "-" + field;
  const displayError = (message: string | undefined, fallback: ExpenseEntryFormKey) =>
    !message || message === "SUPPLIER_SEARCH_FAILED" || (!isAr && /[\u0600-\u06ff]/.test(message)) ? t(fallback) : message;
  const [query, setQuery] = useState(supplierName || "");
  const [debouncedQuery, setDebouncedQuery] = useState(supplierName || "");
  const [tableSuppliers, setTableSuppliers] = useState<SupplierOption[]>([]);
  const [legacySuppliers, setLegacySuppliers] = useState<SupplierOption[]>(() =>
    suppliersStore.getAll().map(mapLegacySupplier)
  );
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newTaxNumber, setNewTaxNumber] = useState("");
  const [newVehicleBrands, setNewVehicleBrands] = useState("");
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => suppliersStore.subscribe(() => {
    setLegacySuppliers(suppliersStore.getAll().map(mapLegacySupplier));
  }), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setSearchError("");
    setSearching(true);
    void loadTableSuppliers(debouncedQuery, supplierId)
      .then((rows) => {
        if (cancelled) return;
        setTableSuppliers(rows);
        if (supplierId) {
          const selected = rows.find((row) => row.id === supplierId);
          if (selected) setQuery((current) => current.trim() ? current : selected.name);
        }
      })
      .catch((error: any) => {
        if (!cancelled) {
          setTableSuppliers([]);
          setSearchError(error?.message || "SUPPLIER_SEARCH_FAILED");
        }
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, supplierId]);

  useEffect(() => {
    setQuery(supplierName || "");
  }, [supplierName, supplierId]);

  const allSuppliers = useMemo(() => {
    const byKey = new Map<string, SupplierOption>();
    tableSuppliers.forEach((supplier) => byKey.set(`id:${supplier.id}`, supplier));
    legacySuppliers.forEach((supplier) => {
      const duplicate = tableSuppliers.find((existing) =>
        normalize(existing.name) === normalize(supplier.name) ||
        (!!supplier.phone && normalize(existing.phone) === normalize(supplier.phone)) ||
        (!!supplier.taxNumber && normalize(existing.taxNumber) === normalize(supplier.taxNumber))
      );
      if (!duplicate) byKey.set(`legacy:${supplier.id}`, supplier);
    });
    return Array.from(byKey.values());
  }, [tableSuppliers, legacySuppliers]);

  const normalizedQuery = normalize(query);
  const filtered = useMemo(() => {
    if (!normalizedQuery) {
      return supplierId ? allSuppliers.filter((supplier) => supplier.id === supplierId) : [];
    }
    if (normalizedQuery.length < 2) return [];
    return allSuppliers
      .filter((supplier) => {
        if (!normalizedQuery) return true;
        return [
          supplier.name,
          supplier.phone,
          supplier.taxNumber,
          supplier.category,
          supplier.notes,
          ...(supplier.vehicleBrands || []),
        ].some((value) => normalize(value).includes(normalizedQuery));
      })
      .slice(0, 8);
  }, [allSuppliers, normalizedQuery, supplierId]);

  const select = async (supplier: SupplierOption) => {
    try {
      const selected = supplier.source === "table"
        ? supplier
        : await ensureTableSupplier({
            name: supplier.name,
            phone: supplier.phone || undefined,
            taxNumber: supplier.taxNumber || undefined,
            category: supplier.category || undefined,
            vehicleBrands: supplier.vehicleBrands || [],
          });

      syncLegacySupplier(selected);
      setQuery(selected.name);
      onChange({ id: selected.id, name: selected.name, taxNumber: selected.taxNumber });
      setTableSuppliers((rows) => rows.some((row) => row.id === selected.id) ? rows : [...rows, selected]);
    } catch (error: any) {
      toast.error(displayError(error?.message, "pickerSelectFailed"));
    }
  };

  const openAddDialog = () => {
    setNewName(query.trim());
    setNewPhone("");
    setNewTaxNumber(taxNumber || "");
    setNewVehicleBrands("");
    setAddOpen(true);
  };

  const saveSupplier = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error(t("pickerNameRequired"));
      return;
    }

    setSaving(true);
    try {
      const duplicate = await findTableDuplicate({ name, phone: newPhone, taxNumber: newTaxNumber });
      const selected = await ensureTableSupplier({
        name,
        phone: newPhone,
        taxNumber: newTaxNumber,
        category: "مصروفات",
        vehicleBrands: parseVehicleBrands(newVehicleBrands),
      });

      if (duplicate?.id) toast.info(t("pickerExistingSelected"));
      else toast.success(t("pickerAddedSelected"));

      syncLegacySupplier(selected);
      setTableSuppliers((rows) => rows.some((row) => row.id === selected.id) ? rows : [...rows, selected]);
      setQuery(selected.name);
      onChange({ id: selected.id, name: selected.name, taxNumber: selected.taxNumber });
      setAddOpen(false);
    } catch (error: any) {
      toast.error(displayError(error?.message, "pickerAddFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1 [&_input]:min-h-11 [&_button]:min-h-11 [&_button]:min-w-11" dir={isAr ? "rtl" : "ltr"}>
      <Label htmlFor={inputId("search")} className="text-xs">{label ?? t("pickerSupplier")}</Label>
      <div className="relative">
        <Search className="absolute start-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          id={inputId("search")}
          aria-label={label ?? t("pickerSupplier")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onClear?.();
          }}
          placeholder={placeholder ?? t("pickerPlaceholder")}
          className="ps-9"
        />
        {searching && <Loader2 role="status" aria-label={t("searching")} className="absolute end-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="rounded-md border border-border bg-background">
        {filtered.length > 0 ? (
          <div className="max-h-40 overflow-auto">
            {filtered.map((supplier) => (
              <button
                key={`${supplier.source}-${supplier.id}`}
                type="button"
                onClick={() => void select(supplier)}
                className={`min-h-11 w-full text-start px-3 py-2 text-xs hover:bg-secondary/60 border-b border-border/50 last:border-b-0 ${
                  supplierId === supplier.id ? "bg-primary/10 text-primary" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{supplier.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {supplier.phone || supplier.taxNumber || t("pickerNoPhone")}
                  </span>
                </div>
                {(supplier.category || supplier.vehicleBrands?.length) && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {[supplier.category === "مصروفات" ? t("pickerExpenseCategory") : supplier.category, ...(supplier.vehicleBrands || [])].filter(Boolean).join(" • ")}
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : searchError ? (
          <div role="alert" className="px-3 py-2 text-xs text-destructive">{t("pickerSearchError", { error: displayError(searchError, "pickerSearchFailed") })}</div>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {t(normalizedQuery.length < 2 ? "pickerSearchMinimum" : searching ? "searching" : "pickerNoMatch")}
          </div>
        )}
        <button
          type="button"
          onClick={openAddDialog}
          className="min-h-11 w-full px-3 py-2 text-xs text-start text-primary hover:bg-primary/10 flex items-center gap-2 border-t border-border"
        >
          <Plus size={13} aria-hidden="true" />
          {t("pickerAddNew")}
        </button>
      </div>
      {supplierId && <p className="text-[10px] text-success">{t("pickerSelected")}</p>}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"} className="max-w-md [&_input]:min-h-11 [&_button]:min-h-11 [&_button]:min-w-11 [&>button:last-child]:hidden">
          <DialogClose asChild><Button type="button" variant="ghost" size="icon" className="absolute end-4 top-4 min-h-11 min-w-11" aria-label={t("pickerClose")}><X className="h-4 w-4" aria-hidden="true" /></Button></DialogClose>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pe-12">
              <Building2 size={18} aria-hidden="true" />{t("pickerAddTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={inputId("name")}>{t("pickerName")}</Label>
              <Input id={inputId("name")} value={newName} onChange={(event) => setNewName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={inputId("phone")}>{t("pickerPhone")}</Label>
              <Input id={inputId("phone")} value={newPhone} onChange={(event) => setNewPhone(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={inputId("tax")}>{t("pickerTaxNumber")}</Label>
              <Input id={inputId("tax")} value={newTaxNumber} onChange={(event) => setNewTaxNumber(event.target.value)} placeholder="OM..." />
            </div>
            <div className="space-y-1">
              <Label htmlFor={inputId("brands")}>{t("pickerBrands")}</Label>
              <Input
                id={inputId("brands")}
                value={newVehicleBrands}
                onChange={(event) => setNewVehicleBrands(event.target.value)}
                placeholder={t("pickerBrandsPlaceholder")}
              />
              <p className="text-[10px] text-muted-foreground">{t("pickerBrandsHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>{t("cancel")}</Button>
            <Button type="button" onClick={saveSupplier} disabled={saving}>
              {t(saving ? "saving" : "pickerSaveAndSelect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
