import { useEffect, useState } from "react";
import { Bell, CheckCheck, Trash2, AlertTriangle, Volume2, VolumeX, Info, AlertOctagon, CheckCircle2, XCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { notificationsStore, getEntityRoute, type NotificationItem } from "@/lib/notificationsStore";
import { getActionLabel, getEntityLabel } from "@/lib/auditLogStore";
import { useOverdueInsuranceAlerts } from "@/hooks/useOverdueInsuranceAlerts";
import { notificationSound } from "@/lib/notificationSound";
import { adminNotificationsStore, type AdminNotification } from "@/lib/adminNotificationsStore";

const ADMIN_TYPE_ICON: Record<string, { I: any; c: string }> = {
  info: { I: Info, c: "text-sky-500" },
  warning: { I: AlertTriangle, c: "text-amber-500" },
  urgent: { I: AlertOctagon, c: "text-red-500" },
  success: { I: CheckCircle2, c: "text-emerald-500" },
  error: { I: XCircle, c: "text-rose-500" },
};

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `قبل ${s} ث`;
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.floor(h / 24);
  return `قبل ${d} يوم`;
}

export default function NotificationsBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [tick, setTick] = useState(0);
  const [activeTab, setActiveTab] = useState("activity");
  const overdue = useOverdueInsuranceAlerts();
  const [soundOn, setSoundOn] = useState(notificationSound.enabled());
  useEffect(() => { const u = notificationSound.subscribe(() => setSoundOn(notificationSound.enabled())); return () => { u(); }; }, []);

  const [adminItems, setAdminItems] = useState<AdminNotification[]>([]);

  useEffect(() => {
    const refresh = () => setItems(notificationsStore.list());
    refresh();
    const unsub = notificationsStore.subscribe(refresh);
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => { unsub(); clearInterval(t); };
  }, []);

  useEffect(() => {
    adminNotificationsStore.init().then(() => setAdminItems(adminNotificationsStore.list()));
    const unsub = adminNotificationsStore.subscribe(() => setAdminItems(adminNotificationsStore.list()));
    return () => { unsub(); };
  }, []);

  void tick;
  const unread = items.filter((n) => !n.read).length;
  const adminUnread = adminItems.filter((n) => !n.read).length;
  const overdueCount = overdue.length;
  const totalCount = unread + overdueCount + adminUnread;

  const handleClick = (n: NotificationItem) => {
    notificationsStore.markRead(n.id);
    const route = getEntityRoute(n.entity, n.entityId);
    navigate(route);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="الإشعارات">
          <Bell size={18} />
          {totalCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {totalCount > 99 ? "99+" : totalCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" dir="rtl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="p-3 border-b border-border bg-secondary/30 flex items-center justify-between">
            <div className="font-semibold text-sm flex items-center gap-2">
              <Bell size={16} />
              الإشعارات
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={soundOn ? "كتم صوت الإشعارات" : "تفعيل صوت الإشعارات"}
                title={soundOn ? "الصوت مفعّل — اضغط للكتم" : "الصوت مكتوم — اضغط للتفعيل"}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = !soundOn;
                  notificationSound.setEnabled(next);
                  if (next) notificationSound.play();
                }}
              >
                {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} className="text-muted-foreground" />}
              </Button>
            </div>
            <TabsList className="h-8">
              <TabsTrigger value="activity" className="text-xs px-2 py-1 relative">
                النشاط
                {unread > 0 && (
                  <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-primary" />
                )}
              </TabsTrigger>
              <TabsTrigger value="admin" className="text-xs px-2 py-1 relative">
                المدير
                {adminUnread > 0 && (
                  <span className="absolute -top-1 -left-1 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {adminUnread}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="alerts" className="text-xs px-2 py-1 relative">
                تنبيهات
                {overdueCount > 0 && (
                  <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-destructive" />
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="activity" className="mt-0">
            <div className="max-h-[380px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  لا توجد إشعارات حتى الآن
                </div>
              ) : items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-right p-3 border-b border-border hover:bg-secondary/40 transition-colors ${!n.read ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm leading-relaxed flex-1">
                      <span className="font-semibold">{n.actor}</span>
                      <span className="text-muted-foreground"> قام بـ </span>
                      <span className="font-medium text-primary">{getActionLabel(n.action)}</span>
                      <span className="text-muted-foreground"> {getEntityLabel(n.entity)} </span>
                      <span className="font-medium">{n.label}</span>
                      {typeof n.amount === "number" && n.amount > 0 && (
                        <span className="text-muted-foreground"> — <span className="font-bold text-foreground">{n.amount.toLocaleString()} ر.ع</span></span>
                      )}
                    </div>
                    {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                  </div>
                  {n.description && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{n.description}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.timestamp)}</div>
                </button>
              ))}
            </div>
            {items.length > 0 && (
              <div className="flex items-center justify-between p-2 border-t border-border bg-secondary/20">
                {unread > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => notificationsStore.markAllRead()}>
                    <CheckCheck size={14} className="ml-1" /> قراءة الكل
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={() => notificationsStore.clear()}>
                  <Trash2 size={14} className="ml-1" /> مسح
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => navigate("/settings/audit-log")}>
                  السجل الكامل ←
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="admin" className="mt-0">
            <div className="max-h-[380px] overflow-y-auto">
              {adminItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">لا توجد إشعارات من المدير</div>
              ) : adminItems.map((n) => {
                const meta = ADMIN_TYPE_ICON[n.type] || ADMIN_TYPE_ICON.info;
                const Icon = meta.I;
                return (
                  <div
                    key={n.id}
                    className={`w-full p-3 border-b border-border hover:bg-secondary/40 transition-colors ${!n.read ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon size={18} className={meta.c + " shrink-0 mt-0.5"} />
                      <button
                        className="flex-1 text-right"
                        onClick={() => {
                          adminNotificationsStore.markRead(n.id);
                          if (n.link) navigate(n.link);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{n.title}</span>
                          {!n.read && <span className="w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">{n.body}</div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {n.sender_name || "المدير"} — {timeAgo(n.created_at)}
                        </div>
                      </button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => adminNotificationsStore.hideForMe(n.id)} title="إخفاء">
                        <X size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {adminItems.length > 0 && (
              <div className="flex items-center justify-between p-2 border-t border-border bg-secondary/20">
                {adminUnread > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => adminNotificationsStore.markAllRead()}>
                    <CheckCheck size={14} className="ml-1" /> قراءة الكل
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs mr-auto" onClick={() => navigate("/admin/notifications")}>
                  إدارة الإشعارات ←
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="alerts" className="mt-0">
            <div className="max-h-[380px] overflow-y-auto">
              {overdueCount === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <AlertTriangle size={20} className="mx-auto mb-2 text-muted-foreground/50" />
                  لا توجد تنبيهات حالياً
                </div>
              ) : overdue.map((o, i) => (
                <button
                  key={i}
                  onClick={() => o.companyId && navigate(`/insurance/companies/${o.companyId}`)}
                  className="w-full text-right p-3 border-b border-border hover:bg-secondary/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{o.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold">
                      {o.oldestDays} يوم
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                    <span>{o.claimsCount} مطالبة</span>
                    <span className="font-bold text-warning">{o.remaining.toLocaleString()} ر.ع</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    مدة السداد المتفق عليها: {o.termsDays} يوم
                  </div>
                </button>
              ))}
            </div>
            {overdueCount > 0 && (
              <div className="p-2 border-t border-border bg-secondary/20">
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => navigate("/insurance/payments")}>
                  فتح لوحة المدفوعات الكاملة ←
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
