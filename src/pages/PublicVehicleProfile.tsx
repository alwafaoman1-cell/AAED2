import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Car, Calendar, Gauge, Palette, FileText, History, DollarSign, Wrench, Shield,
  Image as ImageIcon, Printer, ShieldOff, Lock, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StatCard from "@/components/StatCard";
import PhotoPairsGrid from "@/components/vehicles/PhotoPairsGrid";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { vehiclesStore } from "@/lib/vehiclesStore";
import { getWorkOrders, type WorkOrder } from "@/lib/workOrdersStore";
import { getVehicleCardHtml } from "@/lib/pdfGenerator";
import { toast } from "sonner";
import { getMasterPasswordNormalized } from "@/lib/publicAccessSettingsStore";

/** يطبّع كلمة السر (أرقام فقط لو الإدخال هاتف، وإلا lowercase trimmed) */
const normalizePwd = (v: string): string => {
  const s = (v || "").trim();
  if (/[\d\s+()-]+/.test(s) && /\d/.test(s)) return s.replace(/\D/g, "");
  return s.toLowerCase();
};
const sessionKey = (plate: string) => `vehicle_share_auth_${plate}`;

export default function PublicVehicleProfile() {
  const { plate } = useParams<{ plate: string }>();
  const decodedPlate = plate ? decodeURIComponent(plate) : "";

  const [tick, setTick] = useState(0);
  useEffect(() => vehiclesStore.subscribe(() => setTick((t) => t + 1)), []);

  const vehicle = useMemo(() => vehiclesStore.getById(decodedPlate), [decodedPlate, tick]);
  const allOrders = useMemo<WorkOrder[]>(() => getWorkOrders(), [tick]);
  const orders = useMemo(
    () => allOrders.filter((o) => o.plate === decodedPlate).sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    [allOrders, decodedPlate],
  );

  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfHtml, setPdfHtml] = useState("");
  const [activePairIdx, setActivePairIdx] = useState(0);

  // ─── Password gate state (must run before any early return) ───
  const [authed, setAuthed] = useState(false);
  const [pwd, setPwd] = useState("");
  useEffect(() => {
    if (!vehicle) return;
    try {
      if (sessionStorage.getItem(sessionKey(vehicle.plate)) === "1") setAuthed(true);
    } catch {}
  }, [vehicle?.plate]);

  // Disabled / not found
  if (!vehicle) {
    return <PublicMessage title="الرابط غير صالح" hint={`لم يتم العثور على سيارة بهذا الرقم: ${decodedPlate}`} />;
  }
  const enabled = vehicle.publicShareEnabled ?? true;
  if (!enabled) {
    return (
      <PublicMessage
        title="هذا الرابط غير متاح حالياً"
        hint="تم تعطيل المشاركة العامة لهذه السيارة من قبل الورشة. الرجاء التواصل مع شركة الوفاء للأعمال."
      />
    );
  }

  const expectedPwd = normalizePwd(vehicle.publicSharePassword || vehicle.ownerPhone || "");
  const masterPwd = getMasterPasswordNormalized();
  function submitPwd(e: React.FormEvent) {
    e.preventDefault();
    if (!expectedPwd && !masterPwd) { setAuthed(true); return; }
    const entered = normalizePwd(pwd);
    if ((expectedPwd && entered === expectedPwd) || (masterPwd && entered === masterPwd)) {
      try { sessionStorage.setItem(sessionKey(vehicle.plate), "1"); } catch {}
      setAuthed(true);
    } else {
      toast.error("كلمة المرور غير صحيحة");
    }
  }

  if (!authed) {
    return (
      <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-7 max-w-sm w-full shadow-card">
          <div className="text-center mb-5">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto mb-3">
              <Lock size={22} className="text-primary" />
            </div>
            <h1 className="text-lg font-bold text-foreground">صفحة محمية</h1>
            <p className="text-xs text-muted-foreground mt-1">
              لعرض بطاقة السيارة <span className="font-mono text-primary">{vehicle.plate}</span> أدخل كلمة المرور
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              كلمة المرور هي رقم هاتف مالك السيارة المسجّل، أو الكلمة التي حدّدتها الورشة عند المشاركة.
            </p>
          </div>
          <form onSubmit={submitPwd} className="space-y-3">
            <div className="relative">
              <KeyRound size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="كلمة المرور / رقم هاتف المالك"
                className="pr-9"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full gradient-gold text-primary-foreground">دخول</Button>
          </form>
          <p className="text-[10px] text-muted-foreground text-center mt-4">
            شركة الوفاء للأعمال — Alwafa Integrated Services
          </p>
        </div>
      </div>
    );
  }

  const hideSensitive = vehicle.publicShareHideSensitive ?? false;
  const totalRepairCost = orders.reduce((sum, o) => sum + (o.totalCost || 0), 0);
  const totalLabor = orders.reduce((sum, o) => sum + (o.laborCost || 0), 0);
  const totalParts = orders.reduce((sum, o) => sum + (o.partsCost || 0), 0);
  const photoPairs = vehicle.photoPairs || [];
  const activePair = photoPairs[activePairIdx];
  const claimsList = orders.filter((o) => o.claimNumber && o.claimNumber !== "-");

  function openPdf() {
    const html = getVehicleCardHtml({
      plate: vehicle.plate,
      type: vehicle.type,
      vin: vehicle.vin,
      year: vehicle.year,
      color: vehicle.color,
      mileage: vehicle.mileage,
      owner: hideSensitive ? "—" : vehicle.owner,
      ownerPhone: hideSensitive ? undefined : vehicle.ownerPhone,
      visits: vehicle.visits || orders.length,
      totalSpent: hideSensitive ? 0 : (vehicle.totalSpent || totalRepairCost),
      lastVisit: vehicle.lastVisit,
      notes: vehicle.notes,
      workOrders: orders.map((o) => ({
        orderNumber: o.id,
        date: o.entryDate,
        serviceType: o.serviceType,
        status: o.status,
        technician: o.technician,
        cost: hideSensitive ? 0 : o.totalCost,
        description: o.diagnosis || o.description,
      })),
      photoPairs: photoPairs.map((p) => ({
        workOrderId: p.workOrderId,
        date: p.date,
        beforeUrl: p.beforeUrl,
        afterUrl: p.afterUrl,
        caption: p.caption,
      })),
      claims: claimsList.map((o) => ({
        claimNumber: o.claimNumber,
        insuranceCompany: o.insurance,
        estimatedAmount: hideSensitive ? 0 : o.totalCost,
        status: "مرتبطة بأمر العمل",
      })),
    });
    setPdfHtml(html);
    setPdfOpen(true);
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Public header / brand */}
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
              <Car size={20} className="text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-foreground truncate">شركة الوفاء للأعمال</div>
              <div className="text-[10px] text-muted-foreground truncate">Alwafa Integrated Services • بطاقة سيارة عامة</div>
            </div>
          </div>
          <Button onClick={openPdf} variant="outline" size="sm" className="gap-1.5 shrink-0">
            <Printer size={14} /> تنزيل PDF
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Vehicle card */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-card">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
              <Car size={36} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-2 mb-1">
                <h1 className="text-2xl font-bold text-foreground">{vehicle.type}</h1>
                <span className="text-xs px-2 py-0.5 rounded-md bg-secondary text-muted-foreground font-mono">
                  {vehicle.plate}
                </span>
              </div>
              {!hideSensitive ? (
                <p className="text-sm text-muted-foreground mb-3">
                  المالك: <span className="text-foreground font-medium">{vehicle.owner}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mb-3 inline-flex items-center gap-1.5">
                  <ShieldOff size={11} /> بيانات المالك مخفية لحماية الخصوصية
                </p>
              )}
              <div className="flex flex-wrap gap-2 text-[11px]">
                {vehicle.year && <Chip icon={Calendar} text={vehicle.year} />}
                {vehicle.color && <Chip icon={Palette} text={vehicle.color} />}
                {vehicle.mileage && <Chip icon={Gauge} text={`${vehicle.mileage} كم`} />}
                {vehicle.vin && <Chip icon={FileText} text={vehicle.vin} mono />}
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className={`grid grid-cols-2 gap-4 ${hideSensitive ? "md:grid-cols-2" : "md:grid-cols-4"}`}>
          <StatCard title="عدد الزيارات" value={orders.length || vehicle.visits} icon={History} variant="info" />
          <StatCard title="عدد الصور الموثقة" value={photoPairs.length} icon={ImageIcon} variant="gold" />
          {!hideSensitive && (
            <>
              <StatCard
                title="إجمالي الإنفاق"
                value={`${(vehicle.totalSpent || totalRepairCost).toLocaleString()} ر.ع`}
                icon={DollarSign}
                variant="success"
              />
              <StatCard title="تكلفة قطع الغيار" value={`${totalParts.toLocaleString()} ر.ع`} icon={Wrench} variant="warning" />
            </>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="info" className="w-full">
          <TabsList className="bg-secondary border border-border flex-wrap h-auto">
            <TabsTrigger value="info" className="gap-1 data-[state=active]:bg-card">
              <Car size={14} /> البيانات
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-1 data-[state=active]:bg-card">
              <History size={14} /> سجل العمل ({orders.length})
            </TabsTrigger>
            <TabsTrigger value="photos" className="gap-1 data-[state=active]:bg-card">
              <ImageIcon size={14} /> صور قبل/بعد ({photoPairs.length})
            </TabsTrigger>
            <TabsTrigger value="claims" className="gap-1 data-[state=active]:bg-card">
              <Shield size={14} /> المطالبات ({claimsList.length})
            </TabsTrigger>
          </TabsList>

          {/* Info */}
          <TabsContent value="info" className="mt-4">
            <div className="bg-card border border-border rounded-xl p-5 shadow-card grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <InfoRow label="رقم اللوحة" value={vehicle.plate} mono />
              <InfoRow label="النوع/الموديل" value={vehicle.type} />
              <InfoRow label="سنة الصنع" value={vehicle.year || "—"} />
              <InfoRow label="اللون" value={vehicle.color || "—"} />
              <InfoRow label="عداد المسافة" value={vehicle.mileage ? `${vehicle.mileage} كم` : "—"} />
              <InfoRow label="VIN" value={vehicle.vin || "—"} mono />
              <InfoRow label="آخر زيارة" value={vehicle.lastVisit || "—"} />
              <InfoRow label="عدد الزيارات" value={String(orders.length || vehicle.visits || 0)} />
              {vehicle.notes && (
                <div className="sm:col-span-2 mt-2">
                  <div className="text-[11px] text-muted-foreground mb-1">ملاحظات</div>
                  <div className="text-sm text-foreground bg-secondary/30 rounded p-3 border border-border">
                    {vehicle.notes}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Timeline */}
          <TabsContent value="timeline" className="mt-4">
            {orders.length === 0 ? (
              <EmptyState icon={History} title="لا توجد أوامر عمل سابقة" />
            ) : (
              <div className="bg-card border border-border rounded-xl p-5 shadow-card">
                <div className="relative pr-6 border-r-2 border-border space-y-6">
                  {orders.map((o, idx) => (
                    <div key={o.id} className="relative">
                      <div className="absolute -right-[31px] top-1 w-5 h-5 rounded-full bg-primary border-4 border-card flex items-center justify-center">
                        <span className="text-[8px] text-primary-foreground font-bold">{orders.length - idx}</span>
                      </div>
                      <div className="bg-secondary/30 border border-border rounded-lg p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-mono font-bold text-primary">{o.id}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-info/15 text-info">{o.serviceType}</span>
                              <StatusBadge status={o.status} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              <Calendar size={10} className="inline ml-1" />
                              {o.entryDate}
                              {!hideSensitive && (
                                <> • الفني: <span className="text-foreground">{o.technician}</span></>
                              )}
                            </p>
                          </div>
                          {!hideSensitive && (
                            <div className="text-left">
                              <div className="text-base font-bold text-foreground">{o.totalCost.toLocaleString()} ر.ع</div>
                            </div>
                          )}
                        </div>
                        {(o.diagnosis || o.description) && (
                          <p className="text-xs text-muted-foreground bg-card/50 rounded p-2 mt-2 border-r-2 border-primary/40">
                            {o.diagnosis || o.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Photos */}
          <TabsContent value="photos" className="mt-4">
            <div className="bg-card border border-border rounded-xl p-5 shadow-card">
              {photoPairs.length === 0 ? (
                <EmptyState icon={ImageIcon} title="لا توجد صور موثقة بعد" />
              ) : (
                <PhotoPairsGrid pairs={photoPairs} />
              )}
            </div>
          </TabsContent>

          {/* Claims */}
          <TabsContent value="claims" className="mt-4">
            <div className="bg-card border border-border rounded-xl p-5 shadow-card">
              {claimsList.length === 0 ? (
                <EmptyState icon={Shield} title="لا توجد مطالبات تأمين" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] text-muted-foreground">
                        <th className="text-right py-2 px-3 font-medium">رقم المطالبة</th>
                        <th className="text-right py-2 px-3 font-medium">شركة التأمين</th>
                        <th className="text-right py-2 px-3 font-medium">أمر العمل</th>
                        <th className="text-right py-2 px-3 font-medium">التاريخ</th>
                        {!hideSensitive && <th className="text-left py-2 px-3 font-medium">المبلغ</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {claimsList.map((o) => (
                        <tr key={o.id} className="border-b border-border/50">
                          <td className="py-2.5 px-3 font-mono text-primary">{o.claimNumber}</td>
                          <td className="py-2.5 px-3 text-foreground">{o.insurance}</td>
                          <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{o.id}</td>
                          <td className="py-2.5 px-3 text-muted-foreground">{o.entryDate}</td>
                          {!hideSensitive && (
                            <td className="py-2.5 px-3 text-left font-medium">{o.totalCost.toLocaleString()} ر.ع</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <footer className="text-center text-[11px] text-muted-foreground py-6 border-t border-border">
          © {new Date().getFullYear()} شركة الوفاء للأعمال — Alwafa Integrated Services
          <div className="mt-1">
            هذه صفحة عامة للعرض فقط. للاستفسار يرجى التواصل مع الورشة.
          </div>
        </footer>
      </main>

      <PdfPreviewDialog
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        htmlContent={pdfHtml}
        title={`بطاقة السيارة ${vehicle.plate}`}
      />
    </div>
  );
}

/* ─── Helpers ─── */

function Chip({ icon: Icon, text, mono }: { icon: any; text: string; mono?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-border text-muted-foreground ${mono ? "font-mono" : ""}`}>
      <Icon size={11} className="text-primary/70" />
      {text}
    </span>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm text-foreground ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status.includes("جاهز") || status.includes("تم")
      ? "bg-success/15 text-success"
      : status.includes("إصلاح") || status.includes("تحت")
      ? "bg-warning/15 text-warning"
      : "bg-info/15 text-info";
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${cls}`}>{status}</span>;
}

function EmptyState({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="text-center py-12">
      <Icon size={40} className="mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-sm text-foreground font-medium">{title}</p>
    </div>
  );
}

function PublicMessage({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6" dir="rtl">
      <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center shadow-card">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-4">
          <ShieldOff size={28} className="text-destructive" />
        </div>
        <h1 className="text-lg font-bold text-foreground mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground">{hint}</p>
        <div className="mt-6 text-[11px] text-muted-foreground border-t border-border pt-4">
          شركة الوفاء للأعمال • Alwafa Integrated Services
        </div>
      </div>
    </div>
  );
}
