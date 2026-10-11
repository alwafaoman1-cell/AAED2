import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Car, User, Hash, X, Eye, EyeOff } from "lucide-react";
import { fetchWorkOrderListPage, type WorkOrder } from "@/lib/workOrdersStore";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/queryKeys";

const CLOSED_STATUSES = ["تم التسليم", "مغلق"];
const OPEN_CLOUD_STATUSES = ["received", "inspection", "waiting_parts", "in_progress", "completed"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (order: WorkOrder) => void;
  title?: string;
  description?: string;
}

const statusColors: Record<string, string> = {
  "تحت الإصلاح": "bg-warning/15 text-warning",
  "بانتظار الموافقة": "bg-info/15 text-info",
  "جاهز للتسليم": "bg-success/15 text-success",
  "تحت الفحص": "bg-primary/15 text-primary",
  "تم التسليم": "bg-success/15 text-success",
  "مغلق": "bg-muted text-muted-foreground",
  "بانتظار قطع الغيار": "bg-warning/15 text-warning",
  "ضبط الجودة": "bg-info/15 text-info",
};
const statusEnglish: Record<string, string> = {
  "تحت الإصلاح": "Under repair",
  "بانتظار الموافقة": "Awaiting approval",
  "جاهز للتسليم": "Ready for delivery",
  "تحت الفحص": "Under inspection",
  "تم التسليم": "Delivered",
  "مغلق": "Closed",
  "بانتظار قطع الغيار": "Awaiting parts",
  "ضبط الجودة": "Quality control",
};

export default function WorkOrderPickerDialog({
  open,
  onOpenChange,
  onPick,
  title,
  description,
}: Props) {
  const { i18n } = useTranslation();
  const { profile } = useAuth();
  const isRtl = i18n.dir() === "rtl";
  const [q, setQ] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setDebouncedSearch("");
      setShowClosed(false);
      setPage(1);
    }
  }, [open]);

  const ordersQuery = useQuery({
    queryKey: queryKeys.jobOrders.picker(profile?.tenant_id, debouncedSearch, showClosed, page),
    queryFn: () => fetchWorkOrderListPage({
      tenantId: profile!.tenant_id,
      page,
      pageSize: 50,
      search: debouncedSearch,
      filters: showClosed ? { archive: "all" } : { archive: "all", statuses: OPEN_CLOUD_STATUSES },
    }),
    enabled: open && Boolean(profile?.tenant_id),
    staleTime: 15_000,
    refetchOnMount: "always",
    retry: false,
  });
  const filtered = (ordersQuery.data?.rows || []).filter((order) => showClosed || !CLOSED_STATUSES.includes(order.status));
  const totalRows = ordersQuery.data?.pagination.totalRows || 0;
  const searchSettling = q.trim() !== debouncedSearch;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-2xl bg-card border-border max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <Search size={18} className="text-primary" />
            {title ?? (isRtl ? "اختر أمر العمل" : "Pick work order")}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{description ?? (isRtl
            ? "ابحث برقم الأمر، اسم العميل، رقم اللوحة، VIN، أو رقم الجوال"
            : "Search by work order, customer, plate, VIN, or phone")}</p>
        </DialogHeader>

        <div className="relative">
          <Search size={14} className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none`} />
          <Input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder={isRtl ? "مثال: WO-C-26-0001 أو أحمد محمد أو أ ب ج 1234" : "Example: WO-C-26-0001, customer, or plate"}
            className="px-9 h-11 text-sm"
          />
          {q && (
            <button
              onClick={() => { setQ(""); setPage(1); }}
              className={`absolute ${isRtl ? "left-3" : "right-3"} top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-secondary text-muted-foreground`}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground flex items-center justify-between px-1">
          <span>{searchSettling ? (isRtl ? "جارٍ البحث…" : "Searching…") : isRtl ? `${filtered.length} من ${totalRows} نتيجة` : `${filtered.length} of ${totalRows} results`}</span>
          <button
            onClick={() => { setShowClosed((s) => !s); setPage(1); }}
            className="flex items-center gap-1 text-primary hover:underline"
          >
            {showClosed ? <EyeOff size={11} /> : <Eye size={11} />}
            {showClosed
              ? (isRtl ? "إخفاء المغلقة/المسلّمة" : "Hide closed/delivered")
              : (isRtl ? "إظهار المغلقة/المسلّمة" : "Show closed/delivered")}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 -mx-6 px-6 space-y-1.5">
          {!profile?.tenant_id || searchSettling || ordersQuery.isPending ? (
            <div role="status" className="text-center py-12 text-muted-foreground text-sm">
              {isRtl ? "جارٍ تحميل أوامر العمل…" : "Loading work orders…"}
            </div>
          ) : ordersQuery.isError ? (
            <div role="alert" className="text-center py-12 text-destructive text-sm border border-dashed border-destructive/40 rounded-lg">
              <p>{isRtl ? "تعذر تحميل أوامر العمل. لم تُعرض نتائج قديمة." : "Could not load work orders. No stale results are shown."}</p>
              <button type="button" onClick={() => void ordersQuery.refetch()} className="mt-2 text-primary underline">
                {isRtl ? "إعادة المحاولة" : "Retry"}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
              {isRtl ? "لا توجد نتائج مطابقة" : "No matching work orders"}
            </div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  onPick(o);
                  onOpenChange(false);
                }}
                className={`w-full ${isRtl ? "text-right" : "text-left"} p-3 rounded-lg border border-border hover:border-primary/60 hover:bg-secondary/40 transition-all group`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <Hash size={12} className="text-primary" />
                    <span className="font-mono text-xs text-primary font-semibold">{o.id}</span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      statusColors[o.status] || "bg-secondary text-foreground"
                    }`}
                  >
                    {isRtl ? o.status : statusEnglish[o.status] || o.status}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1.5 text-foreground">
                    <User size={11} className="text-muted-foreground" />
                    <span className="truncate">{o.customer}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Car size={11} />
                    <span className="truncate">
                      {o.vehicleType} {o.model} — <span className="font-mono">{o.plate}</span>
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        {!searchSettling && ordersQuery.data && ordersQuery.data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="disabled:opacity-40 text-primary">
              {isRtl ? "السابق" : "Previous"}
            </button>
            <span>{page} / {ordersQuery.data.pagination.totalPages}</span>
            <button type="button" disabled={page >= ordersQuery.data.pagination.totalPages} onClick={() => setPage((current) => current + 1)} className="disabled:opacity-40 text-primary">
              {isRtl ? "التالي" : "Next"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
