import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Users, Plus, Search, Sparkles, DollarSign, TrendingUp, Phone, Trash2, Edit, MessageCircle, FileSpreadsheet, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { useBulkSelection, exportRowsAsCsv } from "@/hooks/useBulkSelection";
import StatCard from "@/components/StatCard";
import CustomerFormDialog from "@/components/customers/CustomerFormDialog";
import ConfirmDeleteDialog from "@/components/ConfirmDeleteDialog";
import { customersStore, type Customer, type CustomerTag } from "@/lib/customersStore";
import { moveToTrash, registerRestoreHandler } from "@/lib/trashStore";
import { canDelete, canEdit } from "@/lib/permissions";
import { toast } from "sonner";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";
import { archiveCustomer } from "@/lib/deletePolicy";

const TAG_LABEL: Record<CustomerTag, string> = { vip: "VIP", regular: "عادي", new: "جديد" };
const TAG_STYLE: Record<CustomerTag, string> = {
  vip: "bg-primary/15 text-primary",
  regular: "bg-info/15 text-info",
  new: "bg-success/15 text-success",
};

export default function Customers() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<"all" | CustomerTag>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "individual" | "company">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const allowEdit = canEdit();
  const allowDelete = canDelete();
  const navigate = useNavigate();
  // declared below after `filtered` is computed; placeholder removed

  useEffect(() => customersStore.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    registerRestoreHandler("customer", (p) => customersStore.restore(p as Customer));
  }, []);

  const customers = useMemo(() => {
    void tick;
    return customersStore.getAll();
  }, [tick]);

  const enriched = useMemo(
    () => customers.map((c) => ({ customer: c, stats: customersStore.getStats(c) })),
    [customers],
  );

  const filtered = useMemo(() => {
    return enriched.filter(({ customer }) => {
      if (tagFilter !== "all" && customer.tag !== tagFilter) return false;
      const cType = customer.type || "individual";
      if (typeFilter !== "all" && cType !== typeFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        customer.name.toLowerCase().includes(q) ||
        (customer.phone || "").includes(q) ||
        (customer.email || "").toLowerCase().includes(q) ||
        (customer.commercialRegistration || "").toLowerCase().includes(q)
      );
    });
  }, [enriched, search, tagFilter, typeFilter]);

  // bulk selection (id = customer.id)
  const bulkItems = useMemo(() => filtered.map(({ customer }) => ({ id: customer.id, customer })), [filtered]);
  const bulk = useBulkSelection(bulkItems);

  const totalRevenue = enriched.reduce((s, e) => s + e.stats.totalSpent, 0);
  const activeCount = enriched.filter((e) => e.stats.visits > 0).length;
  const vipCount = customers.filter((c) => c.tag === "vip").length;
  const companyCount = customers.filter((c) => c.type === "company").length;

  async function handleDelete() {
    if (!deleting) return;
    try {
      await archiveCustomer(deleting.id, "Archive Customer Only");
    } catch (error: any) {
      toast.error(error?.message || "فشل حذف/أرشفة العميل في Supabase");
      return;
    }
    customersStore.remove(deleting.id);
    moveToTrash({
      type: "customer",
      entityId: deleting.id,
      label: `${deleting.name}${deleting.phone ? ` - ${deleting.phone}` : ""}`,
      payload: deleting,
    });
    toast.success(`تم نقل ${deleting.name} للمهملات`);
    setDeleting(null);
  }

  async function whatsapp(phone: string) {
    if (!phone) { toast.error("لا يوجد رقم جوال"); return; }
    try {
      await sendWhatsAppMessage({ message: "مرحباً، نتواصل معك من ورشة الوفاء.", phone, recipientType: "customer" });
      toast.success("تم إرسال الرسالة");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
    }
  }

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("customers.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("customers.subtitle")}</p>
        </div>
        {allowEdit && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2 gradient-gold text-primary-foreground hover:opacity-90">
            <Plus size={18} /> {t("customers.newCustomer")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard title={isRtl ? "إجمالي العملاء" : "Total Customers"} value={customers.length} icon={Users} variant="info" />
        <StatCard title={isRtl ? "شركات" : "Companies"} value={companyCount} icon={Building2} variant="info" />
        <StatCard title={isRtl ? "عملاء نشطون" : "Active Customers"} value={activeCount} icon={TrendingUp} variant="success" />
        <StatCard title={isRtl ? "عملاء VIP" : "VIP Customers"} value={vipCount} icon={Sparkles} variant="gold" />
        <StatCard title={isRtl ? "إجمالي الإيرادات" : "Total Revenue"} value={`${totalRevenue.toLocaleString()} ${t("common.currency")}`} icon={DollarSign} variant="warning" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="ابحث بالاسم أو الجوال أو الإيميل أو السجل التجاري..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل (أفراد وشركات)</SelectItem>
            <SelectItem value="individual">أفراد فقط</SelectItem>
            <SelectItem value="company">شركات فقط</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tagFilter} onValueChange={(v) => setTagFilter(v as typeof tagFilter)}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل التصنيفات</SelectItem>
            <SelectItem value="vip">VIP</SelectItem>
            <SelectItem value="regular">عادي</SelectItem>
            <SelectItem value="new">جديد</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground text-sm">
            {customers.length === 0 ? "لا يوجد عملاء بعد. أضف أول عميل." : "لا توجد نتائج مطابقة."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30 text-[11px] text-muted-foreground">
                  <th className="py-3 px-3 w-10">
                    <Checkbox
                      checked={bulk.allChecked}
                      onCheckedChange={() => bulk.toggleAll()}
                      aria-label="تحديد الكل"
                    />
                  </th>
                  <th className="text-right py-3 px-4 font-medium">الاسم</th>
                  <th className="text-right py-3 px-4 font-medium">الجوال</th>
                  <th className="text-right py-3 px-4 font-medium hidden md:table-cell">السيارات</th>
                  <th className="text-right py-3 px-4 font-medium hidden md:table-cell">الزيارات</th>
                  <th className="text-right py-3 px-4 font-medium">إجمالي الإنفاق</th>
                  <th className="text-right py-3 px-4 font-medium hidden md:table-cell">آخر زيارة</th>
                  <th className="text-right py-3 px-4 font-medium">التصنيف</th>
                  <th className="text-right py-3 px-4 font-medium">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ customer, stats }) => (
                  <tr
                    key={customer.id}
                    onClick={() => navigate(`/customers/${customer.id}`)}
                    className={`border-b border-border/50 hover:bg-secondary/20 cursor-pointer transition-colors ${bulk.isSelected(customer.id) ? "bg-primary/5" : ""}`}
                  >
                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={bulk.isSelected(customer.id)} onCheckedChange={() => bulk.toggle(customer.id)} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {customer.type === "company" && (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-info/15 text-info" title="شركة">
                            <Building2 size={12} />
                          </span>
                        )}
                        <span className="text-foreground font-medium hover:text-primary">
                          {customer.name}
                        </span>
                        {customer.type === "company" && customer.contactPerson && (
                          <span className="text-[10px] text-muted-foreground hidden sm:inline">
                            · {customer.contactPerson}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground" dir="ltr">{customer.phone || "-"}</td>
                    <td className="py-3 px-4 hidden md:table-cell">{stats.vehiclesCount}</td>
                    <td className="py-3 px-4 hidden md:table-cell">{stats.visits}</td>
                    <td className="py-3 px-4 font-medium">{stats.totalSpent.toLocaleString()} ر.ع</td>
                    <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{stats.lastVisit || "—"}</td>
                    <td className="py-3 px-4">
                      <span className={`text-[10px] px-2 py-1 rounded-full font-medium inline-flex items-center gap-1 ${TAG_STYLE[customer.tag]}`}>
                        {customer.tag === "vip" && <Sparkles size={9} />}
                        {TAG_LABEL[customer.tag]}
                      </span>
                    </td>
                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {customer.phone && (
                          <button onClick={() => whatsapp(customer.phone)} className="p-1.5 rounded-md hover:bg-success/10 text-success" title="WhatsApp">
                            <MessageCircle size={14} />
                          </button>
                        )}
                        {customer.phone && (
                          <a href={`tel:${customer.phone}`} className="p-1.5 rounded-md hover:bg-info/10 text-info" title="اتصال">
                            <Phone size={14} />
                          </a>
                        )}
                        {allowEdit && (
                          <button onClick={() => { setEditing(customer); setFormOpen(true); }} className="p-1.5 rounded-md hover:bg-primary/10 text-primary" title="تعديل">
                            <Edit size={14} />
                          </button>
                        )}
                        {allowDelete && (
                          <button onClick={() => setDeleting(customer)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive" title="حذف">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} />
      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`حذف ${deleting?.name || ""}`}
        description="سيتم نقل العميل لسلة المهملات. سياراته وأوامر عمله لن تُحذف."
      />

      <BulkActionBar count={bulk.count} onClear={bulk.clear} label="عميل">
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => {
          const rows = bulk.selectedItems.map(({ customer }) => {
            const stats = customersStore.getStats(customer);
            return [customer.name, customer.phone || "", customer.email || "", customer.tag, stats.visits, stats.totalSpent.toFixed(3), stats.lastVisit || ""];
          });
          exportRowsAsCsv(`customers-${new Date().toISOString().slice(0,10)}`, ["الاسم","الجوال","الإيميل","التصنيف","الزيارات","الإنفاق","آخر زيارة"], rows);
          toast.success(`تم تصدير ${rows.length} عميل`);
        }}>
          <FileSpreadsheet size={14} /> تصدير
        </Button>
        {allowDelete && (
          <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={async () => {
            if (!confirm(`حذف ${bulk.count} عميل؟ سيتم نقلهم للمهملات.`)) return;
            for (const { customer } of bulk.selectedItems) {
              try {
                await archiveCustomer(customer.id, "Bulk Archive Customer Only");
              } catch (error: any) {
                toast.error(error?.message || `فشل حذف/أرشفة العميل ${customer.name} في Supabase`);
                return;
              }
              customersStore.remove(customer.id);
              moveToTrash({ type: "customer", entityId: customer.id, label: `${customer.name}${customer.phone ? ` - ${customer.phone}` : ""}`, payload: customer });
            }
            toast.success(`تم نقل ${bulk.count} عميل للمهملات`);
            bulk.clear();
          }}>
            <Trash2 size={14} /> حذف
          </Button>
        )}
      </BulkActionBar>
    </div>
  );
}
