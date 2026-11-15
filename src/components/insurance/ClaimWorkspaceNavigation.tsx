import { Calculator, ClipboardCheck, CheckCircle2, PackageCheck, Receipt, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import "@/lib/i18n/claimWorkspace";

const stages = [
  { key: "inspect", icon: ClipboardCheck },
  { key: "estimate", icon: Calculator },
  { key: "approval", icon: CheckCircle2 },
  { key: "workorder", icon: Wrench },
  { key: "delivery", icon: PackageCheck },
  { key: "payments", icon: Receipt },
] as const;

export default function ClaimWorkspaceNavigation({ isNew }: { isNew: boolean }) {
  const { t, i18n } = useTranslation("claimWorkspace");

  return (
    <TabsList
      aria-label={t("nav.label")}
      dir={i18n.dir()}
      className="grid h-auto w-full grid-cols-3 gap-1.5 p-1.5 xl:grid-cols-6"
    >
      {stages.map(({ key, icon: Icon }) => (
        <TabsTrigger
          key={key}
          value={key}
          disabled={isNew && (key === "delivery" || key === "payments")}
          className="min-h-14 min-w-0 flex-col gap-1 whitespace-normal px-2 py-2 text-center text-xs leading-5 xl:flex-row xl:gap-2"
        >
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 max-w-full break-words">{t(`nav.${key}`)}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
