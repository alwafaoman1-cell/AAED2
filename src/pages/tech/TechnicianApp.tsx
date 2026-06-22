import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search, Camera, Workflow, Car, Phone, Eye, LogOut, Download, RefreshCw, Wrench,
  Bell, BellOff, ScanLine, Wifi, WifiOff, MessageCircle, Timer, StickyNote, Play, Square,
  CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import AiWriteButton from "@/components/ai/AiWriteButton";
import {
  getWorkOrders, subscribeWorkOrders, updateWorkOrder, type WorkOrder,
} from "@/lib/workOrdersStore";
import WorkOrderStatusDialog from "@/components/workorders/WorkOrderStatusDialog";
import StagePhotosDialog from "@/components/workorders/StagePhotosDialog";
import { useAuth } from "@/contexts/AuthContext";
import { toEnglishDigits, formatPlateLatin } from "@/lib/numberUtils";
import { toast } from "sonner";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";
import { requestNotifyPermission, startTechNotifications, canNotify } from "@/lib/techNotifications";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  getActiveClock, clockIn, clockOut, subscribeTechStore, listNotes, addNote, deleteNote, getTodayLogs,
} from "@/lib/techClockStore";

const STATUS_TONE: Record<string, string> = {
  "تحت الفحص": "bg-primary/15 text-primary border-primary/30",
  "بانتظار الموافقة": "bg-info/15 text-info border-info/30",
  "بانتظار قطع الغيار": "bg-warning/15 text-warning border-warning/30",
  "تحت الإصلاح": "bg-warning/15 text-warning border-warning/30",
  "ضبط الجودة": "bg-info/15 text-info border-info/30",
  "جاهز للتسليم": "bg-success/15 text-success border-success/30",
  "تم التسليم": "bg-success/25 text-success border-success/40",
  "مغلق": "bg-muted text-muted-foreground border-border",
};

const ACTIVE_STATUSES = new Set([
  "تحت الفحص", "بانتظار الموافقة", "بانتظار قطع الغيار", "تحت الإصلاح", "ضبط الجودة",
]);

type Tab = "mine" | "all" | "done";

export default function TechnicianApp() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const dir: "rtl" | "ltr" = isAr ? "rtl" : "ltr";
  const { profile, signOut, hasRole } = useAuth();
  const [orders, setOrders] = useState<WorkOrder[]>(() => getWorkOrders());
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("mine");
  const [statusFor, setStatusFor] = useState<WorkOrder | null>(null);
  const [photosFor, setPhotosFor] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<WorkOrder | null>(null);
  const [noteText, setNoteText] = useState("");
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [notifyState, setNotifyState] = useState<NotificationPermission | "unsupported">(
    canNotify() ? Notification.permission : "unsupported"
  );
  const [clockTick, setClockTick] = useState(0);
  const { online, queued } = useOnlineStatus();

  useEffect(() => subscribeWorkOrders(() => setOrders(getWorkOrders())), []);
  useEffect(() => { const u = subscribeTechStore(() => setClockTick((t) => t + 1)); return () => { u(); }; }, []);
  useEffect(() => {
    const t = setInterval(() => setClockTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // start local notifications watcher
  useEffect(() => {
    const stop = startTechNotifications(() => profile?.full_name || "");
    return stop;
  }, [profile?.full_name]);

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setInstallEvent(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const myName = profile?.full_name?.trim() || "";
  const isPrivileged = hasRole("admin", "manager");
  const activeClock = getActiveClock();

  const visible = useMemo(() => {
    let list = orders.slice();
    if (tab === "mine" && myName) list = list.filter((o) => (o.technician || "").trim() === myName);
    if (tab === "done") list = list.filter((o) => o.status === "تم التسليم" || o.status === "مغلق" || o.status === "جاهز للتسليم");
    else list = list.filter((o) => ACTIVE_STATUSES.has(o.status) || tab === "all");
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((o) =>
        [o.id, o.customer, o.plate, o.vehicleType, o.model, o.technician, o.claimNumber]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
  }, [orders, tab, myName, search]);

  const counts = useMemo(() => {
    const mine = orders.filter((o) => myName && (o.technician || "").trim() === myName && ACTIVE_STATUSES.has(o.status)).length;
    const all = orders.filter((o) => ACTIVE_STATUSES.has(o.status)).length;
    const done = orders.filter((o) => o.status === "تم التسليم" || o.status === "مغلق" || o.status === "جاهز للتسليم").length;
    return { mine, all, done };
  }, [orders, myName]);

  const handleInstall = async () => {
    if (!installEvent) {
      toast.info("افتح القائمة في المتصفح ثم اختر «إضافة إلى الشاشة الرئيسية» لتثبيت التطبيق.");
      return;
    }
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") toast.success("تم تثبيت التطبيق بنجاح");
    setInstallEvent(null);
  };

  const handleEnableNotify = async () => {
    const res = await requestNotifyPermission();
    setNotifyState(res);
    if (res === "granted") toast.success("تم تفعيل الإشعارات");
    else toast.warning("الإشعارات مرفوضة — يمكن تفعيلها من إعدادات المتصفح");
  };

  const handleClockToggle = (o?: WorkOrder) => {
    if (activeClock) {
      const r = clockOut();
      if (r) toast.success(`تم الإيقاف — ${r.minutes} دقيقة` + (r.orderId ? ` على ${r.orderId}` : ""));
    } else if (o && myName) {
      clockIn(myName, o.id);
      toast.success(`بدأ العمل على ${o.id}`);
    } else if (myName) {
      clockIn(myName);
      toast.success("بدأ التتبع");
    } else {
      toast.error("لا يوجد ملف شخصي");
    }
  };

  const handleQuickComplete = (o: WorkOrder) => {
    if (o.status === "جاهز للتسليم") return;
    updateWorkOrder(o.id, { status: "جاهز للتسليم" });
    toast.success(`${o.id} → جاهز للتسليم`);
  };

  const handleSaveNote = () => {
    if (!notesFor || !noteText.trim()) return;
    addNote(notesFor.id, myName || "—", noteText);
    setNoteText("");
    toast.success("تم حفظ الملاحظة");
  };

  const todayLogs = getTodayLogs();
  const todayMinutes = todayLogs.reduce((s: number, l: any) => s + (l.minutes || 0), 0);

  return (
    <div className="min-h-screen bg-background text-foreground" dir={dir}>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border pt-safe">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Wrench className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold leading-tight truncate">{t("tech.title")}</h1>
            <p className="text-[11px] text-muted-foreground truncate">
              {t("tech.subtitle", { name: profile?.full_name || "—", count: counts.mine, mins: todayMinutes })}
            </p>
          </div>
          <LanguageSwitcher size="icon" showLabel={false} />
          <Button size="icon" variant="ghost" onClick={() => navigate("/tech/scan")} title={t("tech.scanQr")} className="h-9 w-9">
            <ScanLine className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleEnableNotify}
            title={notifyState === "granted" ? t("tech.notifyEnabled") : t("tech.enableNotify")}
            className="h-9 w-9"
          >
            {notifyState === "granted" ? <Bell className="h-4 w-4 text-success" /> : <BellOff className="h-4 w-4" />}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setOrders(getWorkOrders())} title={t("tech.refresh")} className="h-9 w-9">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={handleInstall} title={t("tech.install")} className="h-9 w-9">
            <Download className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => signOut()} title={t("tech.signOut")} className="h-9 w-9">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-3 pb-2 flex items-center gap-2 text-[11px]">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${online ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? t("tech.online") : t("tech.offline")}
            {queued > 0 && <span className="ml-1">· {t("tech.queued", { n: queued })}</span>}
          </span>
          {activeClock ? (
            <button
              onClick={() => handleClockToggle()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-warning/10 text-warning border-warning/30"
            >
              <Square className="h-3 w-3" /> {t("tech.stopTracking")}
              {activeClock.orderId && <span className="opacity-70">· {activeClock.orderId}</span>}
            </button>
          ) : (
            <button
              onClick={() => handleClockToggle()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/30"
            >
              <Play className="h-3 w-3" /> {t("tech.startTracking")}
            </button>
          )}
        </div>

        <div className="px-3 pb-3 space-y-2">
          <div className="relative">
            <Search className={`absolute ${isAr ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground`} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tech.searchPlaceholder")}
              className={isAr ? "pr-10 h-11" : "pl-10 h-11"}
            />
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="grid grid-cols-3 w-full h-11">
              <TabsTrigger value="mine" className="text-xs">{t("tech.tabMine", { n: counts.mine })}</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">{t("tech.tabAll", { n: counts.all })}</TabsTrigger>
              <TabsTrigger value="done" className="text-xs">{t("tech.tabDone", { n: counts.done })}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="px-3 py-3 pb-24 space-y-3">
        {visible.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground bg-card border-border">
            {t("tech.empty")}
          </Card>
        )}


        {visible.map((o) => {
          const isActiveTimer = activeClock?.orderId === o.id;
          return (
            <Card key={o.id} className={`p-3 bg-card border space-y-3 active:scale-[0.99] transition ${isActiveTimer ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-primary font-bold">{toEnglishDigits(o.id)}</span>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_TONE[o.status] || ""}`}>{o.status}</Badge>
                    {isActiveTimer && <Badge variant="outline" className="text-[10px] bg-warning/15 text-warning border-warning/30 gap-1"><Timer className="h-3 w-3" /> {t("tech.tracking")}</Badge>}
                  </div>
                  <p className="text-sm font-semibold mt-1 truncate">{o.customer}</p>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Car className="h-3 w-3" />
                    <span className="truncate">{o.vehicleType} {o.model} · {formatPlateLatin(o.plate)}</span>
                  </div>
                  {o.diagnosis && <p className="text-xs text-foreground/80 mt-1 line-clamp-2">{o.diagnosis}</p>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="default" className="h-10 text-xs" onClick={() => setStatusFor(o)}>
                  <Workflow className="h-4 w-4 mx-1" /> {t("tech.btnStatus")}
                </Button>
                <Button size="sm" variant="secondary" className="h-10 text-xs" onClick={() => setPhotosFor(o.id)}>
                  <Camera className="h-4 w-4 mx-1" /> {t("tech.btnPhotos")}
                </Button>
                <Button size="sm" variant="outline" className="h-10 text-xs" onClick={() => navigate(`/work-orders/${o.id}`)}>
                  <Eye className="h-4 w-4 mx-1" /> {t("tech.btnDetails")}
                </Button>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                <Button size="sm" variant="ghost" className="h-9 text-[11px] px-1" onClick={() => setNotesFor(o)}>
                  <StickyNote className="h-3.5 w-3.5 mx-1" /> {t("tech.btnNote")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-[11px] px-1"
                  onClick={() => handleClockToggle(o)}
                  disabled={!!activeClock && !isActiveTimer}
                >
                  {isActiveTimer ? <><Square className="h-3.5 w-3.5 mx-1" /> {t("tech.btnStop")}</> : <><Play className="h-3.5 w-3.5 mx-1" /> {t("tech.btnStart")}</>}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-[11px] px-1"
                  onClick={() => handleQuickComplete(o)}
                  disabled={o.status === "جاهز للتسليم"}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mx-1" /> {t("tech.btnReady")}
                </Button>
                {o.phone ? (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await sendWhatsAppMessage({
                          message: `مرحباً ${o.customer}، نتواصل معك بخصوص أمر العمل ${o.id}.`,
                          phone: o.phone,
                          workOrderId: o.id,
                          recipientName: o.customer,
                          recipientType: "customer",
                        });
                        toast.success("تم إرسال الرسالة عبر واتساب");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
                      }
                    }}
                    className="inline-flex items-center justify-center h-9 text-[11px] rounded-md hover:bg-secondary text-success"
                  >
                    <MessageCircle className="h-3.5 w-3.5 mx-1" /> {t("tech.btnWa")}
                  </button>
                ) : <span />}
              </div>


              {o.phone && (
                <a href={`tel:${o.phone}`} className="flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-primary py-1">
                  <Phone className="h-3 w-3" /> {toEnglishDigits(o.phone)}
                </a>
              )}
            </Card>
          );
        })}
      </main>

      <WorkOrderStatusDialog
        order={statusFor}
        open={!!statusFor}
        onOpenChange={(o) => !o && setStatusFor(null)}
        onUpdated={() => setOrders(getWorkOrders())}
      />
      <StagePhotosDialog
        orderId={photosFor}
        open={!!photosFor}
        onClose={() => { setPhotosFor(null); setOrders(getWorkOrders()); }}
      />

      {/* Notes sheet */}
      <Sheet open={!!notesFor} onOpenChange={(o) => !o && setNotesFor(null)}>
        <SheetContent side="bottom" className="h-[80vh] bg-card border-border" dir={dir}>
          <SheetHeader>
            <SheetTitle className="text-foreground">
              {t("tech.notesTitle", { id: notesFor?.id, customer: notesFor?.customer })}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 mt-4">
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("tech.noteHint")}
              className="min-h-[90px]"
            />
            <div className="flex justify-end">
              <AiWriteButton
                value={noteText}
                onChange={setNoteText}
                context={`ملاحظة فني — أمر العمل ${notesFor?.id} — العميل ${notesFor?.customer ?? "—"} — المركبة ${notesFor?.plate ?? "—"}`}
                label="ذكاء"
                size="sm"
              />
            </div>
            <Button onClick={handleSaveNote} disabled={!noteText.trim()} className="w-full h-11">
              {t("tech.saveNote")}
            </Button>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pt-2 border-t border-border">
              {notesFor && listNotes(notesFor.id).length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">{t("tech.noNotes")}</p>
              )}
              {notesFor && listNotes(notesFor.id).map((n) => (
                <div key={n.id} className="p-2 rounded-lg border border-border bg-secondary/30 text-xs space-y-1">
                  <p className="text-foreground whitespace-pre-wrap">{n.text}</p>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{n.technician} · {new Date(n.createdAt).toLocaleString("en-GB")}</span>
                    <button onClick={() => { deleteNote(n.id); setClockTick((t) => t + 1); }} className="text-destructive hover:underline">{t("tech.del")}</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}
