import { ChevronDown, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CENTER_LOCATION_TABS, CENTER_RECORD_TABS } from "@/lib/vehicleCenterPresentation";
import type { VehicleCenterPage, VehicleCenterTab } from "@/lib/vehicleVisitLifecycle";
import "@/lib/i18n/vehicleCenterMobile";

export function VehicleCenterNavigation({ active, counts, label, onChange }: {
  active: VehicleCenterTab; counts?: VehicleCenterPage["tabs"]; label: (tab: VehicleCenterTab) => string; onChange: (tab: VehicleCenterTab) => void;
}) {
  const { t, i18n } = useTranslation();
  const isLocation = CENTER_LOCATION_TABS.includes(active), isRecord = CENTER_RECORD_TABS.includes(active);
  return <section className="space-y-2" aria-label={t("vehicleCenterMobile.locations")}>
    <div role="tablist" aria-label={t("vehicleEntry.location")} className="grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-1"
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const direction = (event.key === "ArrowRight" ? 1 : -1) * (i18n.dir() === "rtl" ? -1 : 1);
        const index = Math.max(0, CENTER_LOCATION_TABS.indexOf(active));
        const next = event.key === "Home" ? CENTER_LOCATION_TABS[0] : event.key === "End" ? CENTER_LOCATION_TABS[2]
          : CENTER_LOCATION_TABS[(index + direction + 3) % 3];
        onChange(next); event.currentTarget.querySelector<HTMLButtonElement>(`#vehicle-entry-tab-${next}`)?.focus();
      }}>
      {CENTER_LOCATION_TABS.map((tab, index) => <button key={tab} type="button" role="tab" id={`vehicle-entry-tab-${tab}`}
        aria-selected={active === tab} aria-controls="vehicle-entry-panel" tabIndex={active === tab || (!isLocation && index === 0) ? 0 : -1}
        className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1.5 py-2 text-center text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:gap-3 sm:text-sm ${active === tab ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        onClick={() => onChange(tab)}><span>{label(tab)}</span><span className="tabular-nums">{counts?.[tab] ?? "—"}</span></button>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <DropdownMenu dir={i18n.dir()}><DropdownMenuTrigger asChild><Button id="vehicle-entry-records" variant="outline" size="sm" className="min-h-9 gap-2 text-xs sm:text-sm"
        aria-controls={!isLocation && isRecord ? "vehicle-entry-panel" : undefined}>
        {t("vehicleCenterMobile.records")} <span className="tabular-nums">{counts ? counts.delivered + counts.cancelled : "—"}</span>{isRecord && <span>· {label(active)}</span>}<ChevronDown className="h-4 w-4" aria-hidden="true" />
      </Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="print:hidden">
        <DropdownMenuRadioGroup value={active} onValueChange={tab => onChange(tab as VehicleCenterTab)}>
          {CENTER_RECORD_TABS.map(tab => <DropdownMenuRadioItem key={tab} value={tab} className="gap-3"><span>{label(tab)}</span><span className="ms-auto tabular-nums">{counts?.[tab] ?? "—"}</span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent></DropdownMenu>
      <Button id="vehicle-entry-review" variant="outline" size="sm" aria-pressed={active === "needs_review"} aria-controls="vehicle-entry-panel"
        className={`min-h-9 gap-2 text-xs sm:text-sm ${active === "needs_review" ? "border-warning bg-warning/10 text-foreground" : "border-warning/40 text-foreground hover:bg-warning/5"}`}
        onClick={() => onChange("needs_review")}><ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />{label("needs_review")}<span className="tabular-nums">{counts?.needs_review ?? "—"}</span></Button>
    </div>
    {!isLocation && <h2 className="text-sm font-semibold" id="vehicle-entry-secondary-label">{label(active)} ({counts?.[active] ?? "—"})</h2>}
  </section>;
}
