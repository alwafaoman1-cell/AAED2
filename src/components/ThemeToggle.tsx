import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/contexts/useTheme";
import type { Theme } from "@/contexts/themeContextState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import "@/lib/i18n/vehicleCenterMobile";

export default function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();
  const { t } = useTranslation();

  const Icon = resolved === "dark" ? Moon : Sun;

  const items: { value: Theme; label: string; icon: React.ElementType }[] = [
    { value: "light", label: t("vehicleCenterMobile.light"), icon: Sun },
    { value: "dark", label: t("vehicleCenterMobile.dark"), icon: Moon },
    { value: "system", label: t("vehicleCenterMobile.system"), icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title={t("vehicleCenterMobile.appearance")}>
          <Icon className="h-4 w-4" />
          <span className="sr-only">{t("vehicleCenterMobile.appearance")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {items.map((it) => (
          <DropdownMenuItem
            key={it.value}
            onClick={() => setTheme(it.value)}
            className={theme === it.value ? "bg-accent" : ""}
          >
            <it.icon className="h-4 w-4 me-2" />
            <span>{it.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
