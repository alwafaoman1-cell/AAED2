import { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";
import { suppliersStore, type Supplier } from "@/lib/suppliersStore";

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
  if (!tenantId) throw new Error("لا يمكن تحديد الورشة الحالية");

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
  if (!tenantId) throw new Error("لا يمكن تحديد الورشة الحالية");

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
  label = "المورد",
  placeholder = "ابحث باسم المورد أو الهاتف أو الرقم الضريبي",
  onChange,
  onClear,
}: SupplierPickerProps) {
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
          setSearchError(error?.message || "تعذر البحث في الموردين");
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
      toast.error(error?.message || "تعذر اختيار المورد من Supabase");
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
      toast.error("اكتب اسم المورد");
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

      if (duplicate?.id) toast.info("المورد موجود مسبقًا وتم اختياره");
      else toast.success("تم إضافة المورد واختياره");

      syncLegacySupplier(selected);
      setTableSuppliers((rows) => rows.some((row) => row.id === selected.id) ? rows : [...rows, selected]);
      setQuery(selected.name);
      onChange({ id: selected.id, name: selected.name, taxNumber: selected.taxNumber });
      setAddOpen(false);
    } catch (error: any) {
      toast.error(error?.message || "تعذر إضافة المورد");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onClear?.();
          }}
          placeholder={placeholder}
          className="pr-9"
        />
        {searching && <Loader2 className="absolute left-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="rounded-md border border-border bg-background">
        {filtered.length > 0 ? (
          <div className="max-h-40 overflow-auto">
            {filtered.map((supplier) => (
              <button
                key={`${supplier.source}-${supplier.id}`}
                type="button"
                onClick={() => void select(supplier)}
                className={`w-full text-right px-3 py-2 text-xs hover:bg-secondary/60 border-b border-border/50 last:border-b-0 ${
                  supplierId === supplier.id ? "bg-primary/10 text-primary" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{supplier.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {supplier.phone || supplier.taxNumber || "بدون هاتف"}
                  </span>
                </div>
                {(supplier.category || supplier.vehicleBrands?.length) && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {[supplier.category, ...(supplier.vehicleBrands || [])].filter(Boolean).join(" • ")}
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : searchError ? (
          <div className="px-3 py-2 text-xs text-destructive">تعذر البحث: {searchError}</div>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {normalizedQuery.length < 2 ? "اكتب حرفين على الأقل للبحث" : searching ? "جاري البحث..." : "لا يوجد مورد مطابق"}
          </div>
        )}
        <button
          type="button"
          onClick={openAddDialog}
          className="w-full px-3 py-2 text-xs text-right text-primary hover:bg-primary/10 flex items-center gap-2 border-t border-border"
        >
          <Plus size={13} />
          + إضافة مورد جديد
        </button>
      </div>
      {supplierId && <p className="text-[10px] text-success">تم اختيار مورد محفوظ.</p>}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 size={18} /> إضافة مورد جديد
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>اسم المورد</Label>
              <Input value={newName} onChange={(event) => setNewName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>رقم الهاتف</Label>
              <Input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>الرقم الضريبي</Label>
              <Input value={newTaxNumber} onChange={(event) => setNewTaxNumber(event.target.value)} placeholder="OM..." />
            </div>
            <div className="space-y-1">
              <Label>ماذا يبيع؟ / ماركات السيارات</Label>
              <Input
                value={newVehicleBrands}
                onChange={(event) => setNewVehicleBrands(event.target.value)}
                placeholder="مثال: لكزس، هيونداي، تويوتا"
              />
              <p className="text-[10px] text-muted-foreground">افصل بين الماركات بفاصلة. ستظهر هذه المعلومات في بحث الموردين.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>إلغاء</Button>
            <Button onClick={saveSupplier} disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ واختيار"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
