import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import { Download, Share2, Smartphone, Apple, Chrome, Copy, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { getPublicBaseUrl } from "@/lib/publicAccessSettingsStore";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectPlatform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export default function InstallAppPage() {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => getPublicBaseUrl(), []);

  useEffect(() => {
    setPlatform(detectPlatform());
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      toast.success(isAr ? "تم تثبيت التطبيق بنجاح" : "App installed successfully");
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    // Detect already-installed (running standalone)
    if (window.matchMedia?.("(display-mode: standalone)").matches) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [isAr]);

  const handleInstall = async () => {
    if (!deferred) {
      toast.info(
        isAr
          ? "افتح الرابط في متصفح Chrome على هاتفك ثم استخدم خيار «تثبيت التطبيق» من القائمة."
          : "Open this link in Chrome on your phone, then choose 'Install app' from the menu.",
      );
      return;
    }
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success(isAr ? "تم نسخ الرابط" : "Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const shareUrl = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "TEMO Auto ERP",
          text: isAr ? "حمّل تطبيق ورشة السيارات" : "Install our auto workshop app",
          url,
        });
      } catch {}
    } else {
      copyUrl();
    }
  };

  const steps = {
    android: isAr
      ? [
          "افتح الرابط في متصفح Chrome على هاتف Android.",
          "اضغط زر «تثبيت التطبيق» أعلاه — أو افتح قائمة المتصفح (⋮) واختر «إضافة إلى الشاشة الرئيسية».",
          "أكّد التثبيت، وسيظهر التطبيق بأيقونته على الشاشة الرئيسية تماماً كأي تطبيق عادي.",
          "افتح التطبيق وسجّل الدخول مرة واحدة فقط.",
        ]
      : [
          "Open this link in Chrome on your Android phone.",
          "Tap the 'Install app' button above — or open the browser menu (⋮) and choose 'Add to Home screen'.",
          "Confirm install. The app icon appears on your home screen just like a regular app.",
          "Open the app and sign in once.",
        ],
    ios: isAr
      ? [
          "افتح الرابط في متصفح Safari على iPhone أو iPad (لا يعمل في Chrome على iOS).",
          "اضغط زر المشاركة في الأسفل (المربع مع السهم لأعلى ⬆).",
          "اختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).",
          "اضغط «إضافة»، وسيظهر التطبيق بأيقونته الخاصة على الشاشة الرئيسية.",
        ]
      : [
          "Open this link in Safari on iPhone/iPad (does not work in Chrome on iOS).",
          "Tap the Share button at the bottom (the square with an up arrow ⬆).",
          "Choose 'Add to Home Screen'.",
          "Tap 'Add' — the app appears on your home screen with its own icon.",
        ],
    desktop: isAr
      ? [
          "افتح الرابط على هاتفك للحصول على أفضل تجربة، أو امسح رمز QR التالي بكاميرا هاتفك.",
          "على الكمبيوتر: ستظهر أيقونة تثبيت في شريط العنوان بمتصفح Chrome/Edge — اضغطها.",
          "أو افتح قائمة المتصفح واختر «تثبيت TEMO Auto ERP».",
        ]
      : [
          "Open the link on your phone for the best experience, or scan the QR code below with your phone camera.",
          "On desktop: an install icon appears in the address bar in Chrome/Edge — click it.",
          "Or open the browser menu and choose 'Install TEMO Auto ERP'.",
        ],
  } as const;

  const currentSteps = steps[platform];
  const dir = isAr ? "rtl" : "ltr";

  return (
    <div dir={dir} className="min-h-screen bg-gradient-to-b from-background to-muted/20 px-4 pt-safe pb-6 md:py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> {isAr ? "الرئيسية" : "Home"}
          </Link>
          <LanguageSwitcher />
        </div>

        <div className="text-center space-y-3">
          <div className="mx-auto h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <img src="/icon-192.png" alt="TEMO Auto ERP" className="h-16 w-16 rounded-xl" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold">
            {isAr ? "ثبّت تطبيق TEMO Auto ERP" : "Install TEMO Auto ERP"}
          </h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {isAr
              ? "تطبيق قابل للتثبيت على الهاتف بدون متجر — يعمل كتطبيق حقيقي بأيقونة على الشاشة الرئيسية، يدعم العمل بدون إنترنت، والإشعارات."
              : "Installable app — no app store needed. Works like a real app with its own home-screen icon, offline support, and notifications."}
          </p>
          {installed && (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
              <Check className="h-3 w-3 me-1" /> {isAr ? "التطبيق مثبّت بالفعل" : "App is already installed"}
            </Badge>
          )}
        </div>

        {/* Primary install action */}
        <Card>
          <CardContent className="pt-6 flex flex-col items-center gap-4">
            <Button
              size="lg"
              className="w-full h-14 text-base"
              onClick={handleInstall}
              disabled={installed}
            >
              <Download className="h-5 w-5 me-2" />
              {installed
                ? isAr ? "مثبّت" : "Installed"
                : deferred
                ? isAr ? "تثبيت التطبيق الآن" : "Install app now"
                : isAr ? "اتبع الخطوات أدناه" : "Follow the steps below"}
            </Button>
            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1" onClick={shareUrl}>
                <Share2 className="h-4 w-4 me-2" />
                {isAr ? "مشاركة الرابط" : "Share link"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={copyUrl}>
                {copied ? <Check className="h-4 w-4 me-2" /> : <Copy className="h-4 w-4 me-2" />}
                {isAr ? "نسخ" : "Copy"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* QR + URL */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {isAr ? "افتح على هاتفك" : "Open on your phone"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row items-center gap-4">
            <div className="bg-white p-3 rounded-lg">
              <QRCodeSVG value={url} size={140} level="M" includeMargin={false} />
            </div>
            <div className="flex-1 w-full space-y-2 text-center md:text-start">
              <p className="text-xs text-muted-foreground">
                {isAr
                  ? "امسح الرمز بكاميرا الهاتف لفتح هذه الصفحة على جهازك مباشرة."
                  : "Scan with your phone camera to open this page directly on your device."}
              </p>
              <code className="block bg-muted p-2 rounded text-xs break-all" dir="ltr">{url}</code>
            </div>
          </CardContent>
        </Card>

        {/* Platform-specific steps */}
        <Tabs value={platform} onValueChange={(v) => setPlatform(v as typeof platform)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="android"><Chrome className="h-4 w-4 me-1" />Android</TabsTrigger>
            <TabsTrigger value="ios"><Apple className="h-4 w-4 me-1" />iPhone</TabsTrigger>
            <TabsTrigger value="desktop"><Smartphone className="h-4 w-4 me-1" />{isAr ? "كمبيوتر" : "Desktop"}</TabsTrigger>
          </TabsList>
          <TabsContent value={platform}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {isAr ? "خطوات التثبيت" : "Installation steps"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {currentSteps.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="text-sm pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground text-center">
          {isAr
            ? "ملاحظة: ميزات التثبيت تعمل فقط على الرابط المنشور — وليس داخل محرر Lovable."
            : "Note: install features only work on the published URL, not inside the Lovable editor."}
        </p>
      </div>
    </div>
  );
}
