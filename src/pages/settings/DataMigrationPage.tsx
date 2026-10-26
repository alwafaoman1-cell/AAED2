import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cloud, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CLOUD_TABLES, readCloudTableCounts, type CloudTableCount } from "@/lib/cloudDataStatus";
import { Button } from "@/components/ui/button";

/** Retains the historical route, but never copies live data into itself. */
export default function DataMigrationPage() {
  const { t } = useTranslation();
  const { profile, hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const [rows, setRows] = useState<CloudTableCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await readCloudTableCounts());
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : t("cloudDataStatus.readFailed"));
    } finally {
      setLoading(false);
    }
  }, [isAdmin, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info">
          <Cloud size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("cloudDataStatus.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("cloudDataStatus.description")}</p>
        </div>
      </div>

      <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4" role="status">
        <AlertTriangle className="shrink-0 text-warning" size={20} />
        <p className="text-sm text-foreground">{t("cloudDataStatus.retiredNotice")}</p>
      </div>

      {!isAdmin ? (
        <p className="text-sm text-destructive">{t("cloudDataStatus.adminOnly")}</p>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">{t("cloudDataStatus.currentWorkshop")}</h2>
              <p className="font-mono text-xs text-muted-foreground">{profile?.tenant_id || "—"}</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader2 size={16} className="me-2 animate-spin" /> : <RefreshCw size={16} className="me-2" />}
              {t("cloudDataStatus.refresh")}
            </Button>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{t("cloudDataStatus.readFailed")}: {error}</p>}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-3 text-start font-semibold">{t("cloudDataStatus.table")}</th>
                  <th className="p-3 text-end font-semibold">{t("cloudDataStatus.visibleRows")}</th>
                  <th className="p-3 text-start font-semibold">{t("cloudDataStatus.status")}</th>
                </tr>
              </thead>
              <tbody>
                {CLOUD_TABLES.map(({ table, labelKey }) => {
                  const row = rows.find((entry) => entry.table === table);
                  return (
                    <tr key={table} className="border-t border-border">
                      <td className="p-3">{t(labelKey)} <span className="font-mono text-xs text-muted-foreground">({table})</span></td>
                      <td className="p-3 text-end font-mono">{row?.count ?? "—"}</td>
                      <td className="p-3 text-start" title={row?.error || undefined}>
                        {row?.error ? <span className="text-destructive">{t("cloudDataStatus.unavailable")}</span>
                          : row ? <span className="text-success">{t("cloudDataStatus.readOnly")}</span>
                            : <span className="text-muted-foreground">{loading ? t("cloudDataStatus.loading") : "—"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("cloudDataStatus.countNote")}</p>
        </div>
      )}
    </div>
  );
}
