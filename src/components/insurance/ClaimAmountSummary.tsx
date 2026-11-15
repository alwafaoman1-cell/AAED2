import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import "@/lib/i18n/claimWorkspace";

export interface ClaimAmountSummaryItem {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "success" | "warning";
}

export default function ClaimAmountSummary({ items }: { items: readonly ClaimAmountSummaryItem[] }) {
  const { t, i18n } = useTranslation("claimWorkspace");

  return (
    <section aria-label={t("summary.title")} dir={i18n.dir()} className="min-w-0 space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{t("summary.title")}</h2>
      <dl className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-4">
            <dt className="break-words text-xs font-medium leading-5 text-muted-foreground">{item.label}</dt>
            <dd className="mt-2 min-w-0 space-y-1.5">
              <span
                dir="ltr"
                data-amount="true"
                className={cn(
                  "block break-all text-left text-lg font-bold leading-7 tabular-nums",
                  item.tone === "success" ? "text-success" : item.tone === "warning" ? "text-warning" : "text-foreground",
                )}
              >
                {item.value}
              </span>
              {item.detail && <p data-amount="true" className="break-words text-xs leading-5 text-muted-foreground">{item.detail}</p>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
