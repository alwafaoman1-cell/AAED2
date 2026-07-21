import { useEffect, useState } from "react";
import { RefreshCw, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

const STORAGE_KEY = "hide_amounts_v1";

export function HideAmountsToggle() {
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("hide-amounts", hidden);
    try { localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0"); } catch {}
  }, [hidden]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={() => setHidden((v) => !v)}
      title={hidden ? "إظهار الأرقام" : "إخفاء الأرقام"}
      aria-label={hidden ? "إظهار الأرقام" : "إخفاء الأرقام"}
    >
      {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
    </Button>
  );
}

export function RefreshDataButton() {
  const qc = useQueryClient();
  const [spinning, setSpinning] = useState(false);

  const handle = async () => {
    setSpinning(true);
    try {
      await qc.refetchQueries({ type: "active" });
      toast({ title: "تم تحديث البيانات" });
    } catch {
      // fallback hard reload
      window.location.reload();
    } finally {
      setTimeout(() => setSpinning(false), 600);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      onClick={handle}
      title="تحديث البيانات"
      aria-label="تحديث البيانات"
    >
      <RefreshCw size={18} className={spinning ? "animate-spin" : ""} />
    </Button>
  );
}
