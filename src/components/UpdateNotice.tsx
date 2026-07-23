// Cloud Update Notice — modal + persistent banner.
// Shows when a newer row appears in `app_versions`. Respects unsaved work,
// supports "remind later", and honours mandatory grace timers.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Download, Clock, AlertTriangle, X } from "lucide-react";
import {
  applyUpdateNow,
  dismissVersion,
  isDismissed,
  isSnoozed,
  remindLater,
  startUpdateWatcher,
  useLatestUpdate,
  type AppVersionRow,
} from "@/lib/updateStore";
import { CURRENT_APP_VERSION } from "@/lib/appVersion";
import { hasUnsavedWork, subscribeUnsavedWork } from "@/lib/unsavedWork";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function UpdateNotice() {
  const latest = useLatestUpdate();
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(hasUnsavedWork());
  const [now, setNow] = useState(Date.now());

  useEffect(() => startUpdateWatcher(), []);
  useEffect(() => subscribeUnsavedWork(setDirty), []);

  // post-update success toast
  useEffect(() => {
    try {
      if (sessionStorage.getItem("post_update_toast") === "1") {
        sessionStorage.removeItem("post_update_toast");
        toast.success(`تم تحديث النظام بنجاح إلى الإصدار ${CURRENT_APP_VERSION}. شكراً لاستخدامكم النظام.`);
      }
    } catch { /* noop */ }
  }, []);

  // when a new version arrives, decide whether to open
  useEffect(() => {
    if (!latest) { setOpen(false); return; }
    if (isDismissed(latest.version)) return;
    if (isSnoozed()) return;
    setOpen(true);
    // single toast announcement
    toast.info(`يوجد تحديث جديد للنظام: الإصدار ${latest.version}`);
  }, [latest]);

  // grace countdown ticker for mandatory updates
  useEffect(() => {
    if (!latest?.mandatory) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [latest?.mandatory]);

  const graceInfo = useMemo(() => {
    if (!latest?.mandatory) return null;
    const deadline = new Date(latest.released_at).getTime() + latest.grace_minutes * 60_000;
    const remainingMs = Math.max(0, deadline - now);
    return {
      remainingMs,
      expired: remainingMs <= 0,
      label: (() => {
        const s = Math.floor(remainingMs / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        return h > 0 ? `${h}س ${m}د` : m > 0 ? `${m}د ${ss}ث` : `${ss}ث`;
      })(),
    };
  }, [latest, now]);

  if (!latest) return null;

  async function handleUpdate(force = false) {
    if (!force && dirty) {
      toast.error("لديك عمل غير محفوظ. يرجى حفظ بياناتك أولاً ثم تطبيق التحديث.");
      return;
    }
    setDownloading(true);
    setProgress(5);
    // Simulated background download — real bytes come on reload
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, Math.round((elapsed / 1500) * 100));
      setProgress(pct);
      if (pct >= 95) clearInterval(tick);
    }, 100);
    setTimeout(() => {
      clearInterval(tick);
      setProgress(100);
      setReady(true);
      setDownloading(false);
    }, 1600);
  }

  function handleApply() {
    if (dirty && !latest?.mandatory) {
      toast.error("لديك عمل غير محفوظ. يرجى حفظ بياناتك أولاً ثم تطبيق التحديث.");
      return;
    }
    applyUpdateNow();
  }

  function handleLater() {
    remindLater(30);
    setOpen(false);
    toast("سنذكّرك بالتحديث خلال 30 دقيقة.");
  }

  function handleDismiss() {
    dismissVersion(latest!.version);
    setOpen(false);
  }

  const showBanner = !open && !isDismissed(latest.version);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => {
        // Mandatory updates can't be closed except via Update/Later
        if (!o && latest.mandatory && !graceInfo?.expired) {
          setOpen(true);
          return;
        }
        setOpen(o);
      }}>
        <DialogContent className="max-w-lg" onInteractOutside={(e) => {
          if (latest.mandatory) e.preventDefault();
        }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary" />
              يوجد تحديث جديد للنظام
            </DialogTitle>
            <DialogDescription>
              {latest.title || "تحسينات وإصلاحات جديدة متوفرة الآن."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="text-xs text-muted-foreground">الإصدار الحالي</div>
                <div className="font-mono text-base mt-1">{CURRENT_APP_VERSION}</div>
              </div>
              <div className="rounded-lg border bg-primary/5 border-primary/30 p-3">
                <div className="text-xs text-primary">الإصدار الجديد</div>
                <div className="font-mono text-base mt-1 text-primary">{latest.version}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              صدر بتاريخ {formatDate(latest.released_at)}
            </div>

            {latest.changelog && (
              <div className="rounded-lg border p-3 max-h-48 overflow-y-auto bg-background">
                <div className="text-xs font-medium mb-1 text-muted-foreground">أهم التحسينات والإصلاحات</div>
                <pre className="whitespace-pre-wrap text-sm leading-6 font-sans">{latest.changelog}</pre>
              </div>
            )}

            {latest.mandatory && graceInfo && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                <div className="text-xs">
                  <div className="font-medium text-destructive">تحديث إجباري</div>
                  <div className="text-muted-foreground mt-0.5">
                    تنتهي مهلة التحديث خلال: <span className="font-mono">{graceInfo.label}</span> — احفظ عملك ثم طبّق التحديث يدوياً.
                  </div>
                </div>
              </div>
            )}

            {dirty && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                لديك عمل غير محفوظ في الصفحة الحالية. يُفضّل حفظه قبل تطبيق التحديث.
              </div>
            )}

            {(downloading || ready) && (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <div className="text-xs text-muted-foreground flex justify-between">
                  <span>{ready ? "اكتمل التنزيل" : "جارٍ تنزيل التحديث..."}</span>
                  <span>{progress}%</span>
                </div>
                {ready && (
                  <div className="text-xs text-green-700 dark:text-green-400">
                    تم تنزيل التحديث بنجاح. اضغط على «تطبيق التحديث» للانتقال إلى الإصدار الجديد.
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 flex-row sm:justify-between">
            {!latest.mandatory ? (
              <Button variant="ghost" size="sm" onClick={handleLater}>
                تذكيري لاحقاً
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              {ready ? (
                <Button onClick={handleApply} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  تطبيق التحديث
                </Button>
              ) : (
                <Button
                  onClick={() => handleUpdate(latest.mandatory)}
                  disabled={downloading}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  {downloading ? "جارٍ التنزيل..." : "تحديث الآن"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showBanner && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 shadow-lg hover:opacity-90 transition text-sm animate-in slide-in-from-bottom-2"
          title="يوجد تحديث جديد"
        >
          <Sparkles className="h-4 w-4" />
          إصدار جديد {latest.version}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            className="ms-2 -me-1 rounded-full hover:bg-primary-foreground/20 p-1"
          >
            <X className="h-3 w-3" />
          </span>
        </button>
      )}
    </>
  );
}
