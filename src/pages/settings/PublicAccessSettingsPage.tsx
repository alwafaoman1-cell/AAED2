import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Eye, EyeOff, Save, Trash2, Globe, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  getPublicAccessSettings,
  savePublicAccessSettings,
} from "@/lib/publicAccessSettingsStore";

const PRESETS = [
  "https://temo.live",
  "https://www.temo.live",
  "https://autopro1.lovable.app",
];

export default function PublicAccessSettingsPage() {
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    const s = getPublicAccessSettings();
    setPwd(s.masterPassword || "");
    setBaseUrl(s.publicBaseUrl || "");
  }, []);

  function handleSave() {
    savePublicAccessSettings({ masterPassword: pwd.trim() });
    toast.success(pwd.trim() ? "طھظ… ط­ظپط¸ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط±ط¦ظٹط³ظٹط©" : "طھظ… طھط¹ط·ظٹظ„ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط±ط¦ظٹط³ظٹط©");
  }

  function handleClear() {
    setPwd("");
    savePublicAccessSettings({ masterPassword: "" });
    toast.success("طھظ… ظ…ط³ط­ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط±ط¦ظٹط³ظٹط©");
  }

  function saveBaseUrl() {
    const v = baseUrl.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//i.test(v)) {
      toast.error("ط§ظ„ط±ط§ط¨ط· ظٹط¬ط¨ ط£ظ† ظٹط¨ط¯ط£ ط¨ظ€ https:// ط£ظˆ http://");
      return;
    }
    savePublicAccessSettings({ publicBaseUrl: v });
    setBaseUrl(v);
    toast.success(v ? `طھظ… ط§ط¹طھظ…ط§ط¯ ${v} ظ„ط±ظˆط§ط¨ط· QR` : "طھظ… ط§ط³طھط®ط¯ط§ظ… ط¯ظˆظ…ظٹظ† ط§ظ„ظ…طھطµظپط­ ط§ظ„ط­ط§ظ„ظٹ");
  }

  function clearBaseUrl() {
    setBaseUrl("");
    savePublicAccessSettings({ publicBaseUrl: "" });
    toast.success("طھظ… ظ…ط³ط­ ط§ظ„ط¯ظˆظ…ظٹظ† ط§ظ„ظ…ط®طµظ‘طµ");
  }

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" /> ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ظˆطµظˆظ„ ط§ظ„ط¹ط§ظ…
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط±ط¦ظٹط³ظٹط© ظ„ظ„ظˆطµظˆظ„ ط§ظ„ط¹ط§ظ… + ط§ظ„ط¯ظˆظ…ظٹظ† ط§ظ„ظ…ط¹طھظ…ط¯ ظ„ط£ظƒظˆط§ط¯ QR ظˆط§ظ„ط±ظˆط§ط¨ط· ط§ظ„ظ…ظڈط´ط§ط±ظƒط©.
        </p>
      </div>

      {/* ===== Public Base URL (QR domain) ===== */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Globe size={14} className="text-primary" /> ط§ظ„ط¯ظˆظ…ظٹظ† ط§ظ„ظ…ط¹طھظ…ط¯ ظ„ط£ظƒظˆط§ط¯ QR
          </label>
          <div className="flex gap-2">
            <Input
              dir="ltr"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://temo.live"
              className="bg-secondary border-border font-mono text-sm"
              autoComplete="off"
            />
            <Button onClick={saveBaseUrl} className="gap-2 shrink-0">
              <Save size={14} /> ط­ظپط¸
            </Button>
            {baseUrl && (
              <Button variant="outline" onClick={clearBaseUrl} className="border-border shrink-0" title="ظ…ط³ط­">
                <Trash2 size={14} />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setBaseUrl(p)}
                className="text-[11px] font-mono px-2 py-1 rounded border border-border bg-secondary/40 hover:bg-secondary text-foreground"
                dir="ltr"
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            â€¢ ظٹظڈط³طھط®ط¯ظ… ظپظٹ: ظ…ط´ط§ط±ظƒط© ط¨ط·ط§ظ‚ط© ط§ظ„ظ…ط±ظƒط¨ط© <code className="font-mono">/p/...</code>طŒ
            ظ…ظ„طµظ‚ طھطھط¨ط¹ ط£ظ…ط± ط§ظ„ط¹ظ…ظ„ <code className="font-mono">/p/...</code>طŒ
            ظˆطµظپط­ط© طھط«ط¨ظٹطھ ط§ظ„طھط·ط¨ظٹظ‚ <code className="font-mono">/install</code>.<br/>
            â€¢ ط§طھط±ظƒظ‡ ظپط§ط±ط؛ط§ظ‹ ظ„ط§ط³طھط®ط¯ط§ظ… ط¯ظˆظ…ظٹظ† ط§ظ„ظ…طھطµظپط­ ط§ظ„ط­ط§ظ„ظٹ طھظ„ظ‚ط§ط¦ظٹط§ظ‹.<br/>
            â€¢ ظٹظڈط­ظپط¸ ظ…ط­ظ„ظٹط§ظ‹ ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط² ظپظ‚ط·.
          </p>
          {baseUrl && (
            <a
              href={baseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              dir="ltr"
            >
              <ExternalLink size={12} /> ظپطھط­ {baseUrl}
            </a>
          )}
        </div>
      </div>

      {/* ===== Master password ===== */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <KeyRound size={14} className="text-primary" /> ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ط§ظ„ط±ط¦ظٹط³ظٹط©
          </label>
          <div className="relative">
            <Input
              type={show ? "text" : "password"}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="ط§طھط±ظƒظ‡ط§ ظپط§ط±ط؛ط© ظ„طھط¹ط·ظٹظ„ظ‡ط§"
              className="bg-secondary border-border pr-3 pl-10 font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-muted text-muted-foreground"
              title={show ? "ط¥ط®ظپط§ط،" : "ط¥ط¸ظ‡ط§ط±"}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            â€¢ طھط¹ظ…ظ„ ظ‡ط°ظ‡ ط§ظ„ظƒظ„ظ…ط© ظپظٹ ط¬ظ…ظٹط¹ طµظپط­ط§طھ <code className="font-mono">/p/...</code> ظˆ <code className="font-mono">/p/...</code>.<br/>
            â€¢ ظ„ط§ طھظڈظ„ط؛ظٹ ظƒظ„ظ…ط© ظ‡ط§طھظپ ط§ظ„ط¹ظ…ظٹظ„ ط£ظˆ ط§ظ„ظƒظ„ظ…ط© ط§ظ„ظ…ط®طµطµط© â€” طھظڈط¶ط§ظپ ط¥ظ„ظٹظ‡ط§.<br/>
            â€¢ طھظڈط­ظپط¸ ظ…ط­ظ„ظٹط§ظ‹ ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط² ظپظ‚ط· ظˆظ„ط§ طھط¸ظ‡ط± ظ„ظ„ط¹ظ…ظٹظ„.
          </p>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground gap-2">
            <Save size={14} /> ط­ظپط¸
          </Button>
          <Button variant="outline" onClick={handleClear} className="border-border gap-2">
            <Trash2 size={14} /> ظ…ط³ط­
          </Button>
        </div>
      </div>
    </div>
  );
}

