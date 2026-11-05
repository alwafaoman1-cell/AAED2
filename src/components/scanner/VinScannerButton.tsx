import { useEffect,useRef, useState } from "react";
import {useTranslation} from "react-i18next";
import "@/lib/i18n/vehicleIdentityFields";
import { Camera, Loader2, X, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  /** Called when VIN successfully extracted */
  onResult: (data: { vin?: string; year?: string }) => void;
  /** Tooltip label */
  title?: string;
}

/**
 * Camera button that captures a photo of a VIN plate/registration card,
 * sends it to the `vin-scan` edge function, and returns {vin, year}.
 * Falls back to file-picker (mobile camera) on devices without getUserMedia.
 */
export default function VinScannerButton({ onResult, title }: Props) {
  const {t}=useTranslation();
  const mounted=useRef(true);
  const streamRef=useRef<MediaStream|null>(null);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;streamRef.current?.getTracks().forEach(track=>track.stop());};},[]);
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const startCamera = async () => {
    setShot(null);
    setOpen(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if(!mounted.current){s.getTracks().forEach(track=>track.stop());return;}
      streamRef.current=s;
      setStream(s);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (e) {
      // Fallback to file input (mobile native camera)
      setOpen(false);
      fileRef.current?.click();
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current=null;
    setStream(null);
  };

  const close = () => {
    stopCamera();
    setShot(null);
    setOpen(false);
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    setShot(canvas.toDataURL("image/jpeg", 0.85));
    stopCamera();
  };

  const handleFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setShot(dataUrl);
      setOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("vin-scan", {
        body: { imageBase64: shot },
      });
      if (error) throw error;
      const vin = (data?.vin || "").toString();
      const year = (data?.year || "").toString();
      if (!vin && !year) {
        toast.error(t("vehicleVinScanner.unreadable"));
        return;
      }
      onResult({ vin, year });
      toast.success(
        `${t("vehicleVinScanner.extracted")}${vin ? ` — VIN: ${vin}` : ""}${year ? ` — ${t("vehicleIdentityFields.year")}: ${year}` : ""}`
      );
      close();
    } catch (e: any) {
      const msg = e?.message || t("vehicleVinScanner.failed");
      toast.error(msg.includes("429") ? t("vehicleVinScanner.rateLimit") : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title={title || t("vehicleVinScanner.title")}
        aria-label={title || t("vehicleVinScanner.title")}
        onClick={startCamera}
        className="shrink-0"
      >
        <Camera className="h-4 w-4" />
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      <Dialog open={open} onOpenChange={(v) => (v ? null : close())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" /> {t("vehicleVinScanner.scanTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="relative bg-foreground rounded-lg overflow-hidden aspect-video">
            {!shot ? (
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            ) : (
              <img src={shot} alt="VIN" className="w-full h-full object-contain" />
            )}
            {/* alignment overlay */}
            {!shot && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="border-2 border-success/80 rounded-md w-[85%] h-[28%]" />
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {t("vehicleVinScanner.hint")}
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            {!shot ? (
              <>
                <Button variant="ghost" onClick={close}><X className="h-4 w-4 me-1" /> {t("vehicleVinScanner.cancel")}</Button>
                <Button onClick={capture} disabled={!stream}>
                  <Camera className="h-4 w-4 me-1" /> {t("vehicleVinScanner.capture")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => { setShot(null); startCamera(); }} disabled={busy}>
                  <RefreshCw className="h-4 w-4 me-1" /> {t("vehicleVinScanner.retake")}
                </Button>
                <Button onClick={analyze} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Check className="h-4 w-4 me-1" />}
                  {t("vehicleVinScanner.extract")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
