import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { listAllMatchingVehicleCenter, listVehicleVisitCenterPage, type VehicleCenterFilters, type VehicleCenterTab } from "@/lib/vehicleVisitLifecycle";
import { printVehicleEntryLabelSheets } from "@/lib/vehicleEntryLabelSheet";
import "@/lib/i18n/vehicleEntryLabels";

type Selection = { key: string; token: string; all: boolean; entries: Map<string, any>; excluded: Set<string> };
const empty = (): Selection => ({ key: "", token: "", all: false, entries: new Map(), excluded: new Set() });

export function useVehicleLabelSelection(input: { tenant: string | undefined; tab: VehicleCenterTab; filters: VehicleCenterFilters; token: string | undefined; total: number; rows: any[]; onStale?: () => void }) {
  const { t, i18n } = useTranslation("vehicleEntryLabels");
  const key = JSON.stringify([input.tenant, input.tab, input.filters]);
  const [stored, setStored] = useState<Selection>(empty);
  const [printing, setPrinting] = useState(false);
  const current = useRef("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [key]);
  current.current = `${key}|${input.token || ""}`;
  const selection = stored.key === key && stored.token === input.token ? stored : empty();
  const checked = (id: string) => selection.all ? !selection.excluded.has(id) : selection.entries.has(id);
  const count = selection.all ? Math.max(0, input.total - selection.excluded.size) : selection.entries.size;
  const pageCount = input.rows.filter((row) => checked(row.id)).length;
  const pageChecked = pageCount === 0 ? false : pageCount === input.rows.length ? true : "indeterminate" as const;
  function change(rows: any[], value: boolean) {
    setStored(() => {
      const next = { ...selection, key, token: input.token || "", entries: new Map(selection.entries), excluded: new Set(selection.excluded) };
      for (const row of rows) {
        if (next.all) { if (value) next.excluded.delete(row.id); else next.excluded.add(row.id); }
        else if (value) next.entries.set(row.id, row); else next.entries.delete(row.id);
      }
      return next;
    });
  }
  async function print() {
    if (!count || printing || !input.token) return;
    const scope = current.current, token = input.token;
    const chosen = { ...selection, entries: new Map(selection.entries), excluded: new Set(selection.excluded) };
    controller.current = new AbortController();
    setPrinting(true);
    try {
      await printVehicleEntryLabelSheets(async () => {
        let entries: any[];
        if (chosen.all) {
          const matches = await listAllMatchingVehicleCenter({ tab: input.tab, filters: input.filters, expectedScopeToken: token });
          entries = matches.map((visit) => ({ ...visit.entry, _reviewReason: visit.reviewReason })).filter((row) => !chosen.excluded.has(row.id));
        } else {
          const fresh = await listVehicleVisitCenterPage({ tab: input.tab, filters: input.filters, page: 1, pageSize: 1 });
          if (fresh.scopeToken !== token) throw new Error("VEHICLE_CENTER_EXPORT_CHANGED");
          entries = [...chosen.entries.values()];
        }
        if (current.current !== scope) throw new Error("VEHICLE_CENTER_EXPORT_CHANGED");
        return entries;
      }, i18n.language.startsWith("ar") ? "ar" : "en", t("loading"), controller.current.signal);
    } catch (cause) {
      const code = (cause as Error)?.message;
      if (code === "VEHICLE_CENTER_EXPORT_CHANGED") { setStored(empty());input.onStale?.(); }
      toast.error(t(code === "VEHICLE_CENTER_EXPORT_CHANGED" ? "changed" : code === "VEHICLE_LABEL_POPUP_BLOCKED" ? "blocked" : "failed"));
    } finally { setPrinting(false); }
  }
  return {
    checked, count, printing, pageChecked,
    toggle: (row: any, value: boolean) => change([row], value),
    togglePage: (value: boolean) => change(input.rows, value),
    selectAll: () => setStored({ key, token: input.token || "", all: true, entries: new Map(), excluded: new Set() }),
    clear: () => setStored(empty()), print,
  };
}

export type VehicleLabelSelection = ReturnType<typeof useVehicleLabelSelection>;
