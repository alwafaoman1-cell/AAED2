import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CarFront, FileSpreadsheet, Plus, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { queryKeys } from "@/lib/queryKeys";
import { listVehicleEntries, VEHICLE_ENTRY_STATUSES } from "@/lib/vehicleEntryService";
import * as XLSX from "xlsx";

export default function VehicleEntryList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = useMemo(() => ({ search, status, from, to }), [search, status, from, to]);
  const { data = [], isLoading, error } = useQuery({
    queryKey: queryKeys.vehicleEntries.list(filters),
    queryFn: () => listVehicleEntries(filters),
    staleTime: 60_000,
  });

  const rows = data as any[];

  function exportExcel() {
    const header = [
      "Entry Number",
      "Arrival Date",
      "Arrival Time",
      "Plate",
      "Vehicle",
      "Customer",
      "Phone",
      "Insurance",
      "Delivered By",
      "Arrival Method",
      "Location",
      "Status",
      "Claim",
      "Work Order",
      "Issued At",
    ];
    const exportRows = rows.map((row) => {
      const vehicle = row.vehicle || {};
      return [
        row.entry_number,
        row.arrival_date,
        String(row.arrival_time || "").slice(0, 5),
        [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" "),
        [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" "),
        row.customer?.name || row.customer_snapshot?.name || "",
        row.customer?.phone || row.customer_snapshot?.phone || "",
        row.insurance_snapshot?.company_name || row.insurance_company?.name || "",
        row.delivered_by?.full_name || "",
        row.arrival_method || "",
        [row.vehicle_location, row.vehicle_location_bay].filter(Boolean).join(" / "),
        row.status,
        row.claim?.claim_number || row.insurance_snapshot?.claim_number || "",
        row.work_order?.order_number || "",
        row.issued_at || "",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([header, ...exportRows]);
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: exportRows.length, c: header.length - 1 } }) };
    ws["!cols"] = header.map((h, i) => ({ wch: Math.max(12, h.length + 2, ...exportRows.map((r) => String(r[i] || "").length + 2)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vehicle Entries");
    XLSX.writeFile(wb, `Vehicle_Entry_Receipts_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">دخول واستلام مركبة</h1>
          <p className="text-sm text-muted-foreground">Vehicle Entry & Receipt — سجل مستقل لوصول المركبات إلى الورشة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()} className="gap-2"><Printer size={16} /> طباعة</Button>
          <Button variant="outline" onClick={exportExcel} className="gap-2"><FileSpreadsheet size={16} /> تصدير</Button>
          <Button onClick={() => navigate("/vehicle-entry/new")} className="gap-2"><Plus size={16} /> دخول مركبة</Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باللوحة، العميل، رقم الدخول..." className="pr-9" />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {VEHICLE_ENTRY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">جاري تحميل نماذج الدخول...</div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">تعذر تحميل نماذج الدخول: {(error as Error).message}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد نماذج دخول مطابقة.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-right">
                  <th className="p-3">رقم الدخول</th>
                  <th className="p-3">الوصول</th>
                  <th className="p-3">السيارة</th>
                  <th className="p-3">العميل</th>
                  <th className="p-3">التأمين</th>
                  <th className="p-3">مسلّم المركبة</th>
                  <th className="p-3">الموقع</th>
                  <th className="p-3">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const vehicle = row.vehicle || row.vehicle_snapshot || {};
                  const customer = row.customer || row.customer_snapshot || {};
                  return (
                    <tr key={row.id} className="border-t border-border hover:bg-muted/30">
                      <td className="p-3 font-mono font-semibold text-primary"><Link to={`/vehicle-entry/${row.id}`}>{row.entry_number}</Link></td>
                      <td className="p-3" dir="ltr">{row.arrival_date} {String(row.arrival_time || "").slice(0, 5)}</td>
                      <td className="p-3">
                        <div className="font-semibold">{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—"}</div>
                        <div className="text-xs text-muted-foreground">{[vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ")}</div>
                      </td>
                      <td className="p-3">{customer.name || "—"}<div className="text-xs text-muted-foreground" dir="ltr">{customer.phone || ""}</div></td>
                      <td className="p-3">{row.insurance_snapshot?.company_name || row.insurance_company?.name || "—"}</td>
                      <td className="p-3">{row.delivered_by?.full_name || "—"}</td>
                      <td className="p-3">{[row.vehicle_location, row.vehicle_location_bay].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="p-3"><span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">{row.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CarFront size={14} />
        <span>النموذج لا ينشئ مطالبة أو أمر عمل تلقائيًا إلا عند اختيار التحويل من صفحة التفاصيل.</span>
      </div>
    </div>
  );
}
