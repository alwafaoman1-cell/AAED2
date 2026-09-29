import { useIsMutating } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Visual progress only: completion and success remain the responsibility of each mutation. */
export default function GlobalMutationStatus() {
  const pending = useIsMutating();
  const { i18n } = useTranslation();
  if (!pending) return null;
  const english = i18n.resolvedLanguage?.startsWith("en");
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 end-4 z-[100] flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur">
      <Loader2 size={15} className="animate-spin text-primary" aria-hidden="true" />
      {english ? "Processing…" : "جارٍ تنفيذ العملية…"}
    </div>
  );
}
