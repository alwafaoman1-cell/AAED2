import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { ArrowRight, ScanLine, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { getWorkOrderById } from "@/lib/workOrdersStore";

export default function TechQrScanPage() {
  const navigate = useNavigate();
  const containerId = "qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(containerId, { verbose: false });
    scannerRef.current = scanner;
    handledRef.current = false;

    const onDecoded = (text: string) => {
      if (handledRef.current) return;
      const raw = (text || "").trim();
      if (!raw) return;
      // Robust lookup handles: raw WO-YYYY-NNN, full URLs (/track/<id>, /work-orders/<id>), UUIDs, displayNumber
      const found = getWorkOrderById(raw);
      if (!found) {
        console.warn("[QR Scan] No work order matched payload:", raw);
        toast.error(`لم يتم العثور على أمر عمل مرتبط بهذا الرمز`);
        return;
      }
      handledRef.current = true;
      toast.success(`فتح ${found.displayNumber || found.id}`);
      navigate(`/work-orders/${found.id}`);
    };

    scanner
      .start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onDecoded, () => {})
      .catch((err) => {
        toast.error("تعذّر فتح الكاميرا — تحقق من الأذونات");
        console.error(err);
      });

    return () => {
      scanner.stop().catch(() => {}).finally(() => scanner.clear());
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border px-3 pt-safe pb-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => navigate("/tech")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="font-bold text-base flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-primary" /> مسح QR
          </h1>
          <p className="text-[11px] text-muted-foreground">وجّه الكاميرا نحو رمز أمر العمل أو ملصق السيارة</p>
        </div>
      </header>

      <main className="p-3 space-y-3">
        <Card className="p-2 bg-card border-border overflow-hidden">
          <div id={containerId} className="w-full rounded-lg overflow-hidden bg-black aspect-[3/4]" />
        </Card>
        <Card className="p-3 text-xs text-muted-foreground bg-card border-border space-y-1">
          <p className="flex items-center gap-2 text-foreground"><Wrench className="h-3 w-3 text-primary" /> نصائح</p>
          <ul className="list-disc pr-4 space-y-0.5">
            <li>تأكد من إضاءة كافية ووضوح الملصق</li>
            <li>يدعم: ملصقات WO وأكواد URL تحوي رقم أمر العمل</li>
            <li>عند النجاح ينتقل تلقائياً إلى صفحة الأمر</li>
          </ul>
        </Card>
      </main>
    </div>
  );
}
