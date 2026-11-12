import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LANGS } from "@/i18n";
import { toast } from "sonner";

interface Props {
  variant?: "ghost" | "outline" | "default";
  size?: "sm" | "default" | "icon";
  showLabel?: boolean;
  compactOnMobile?: boolean;
}

/**
 * Compact language switcher used in the sidebar / header.
 * Persists choice automatically (i18next localStorage detector).
 */
export default function LanguageSwitcher({
  variant = "ghost",
  size = "sm",
  showLabel = true,
  compactOnMobile = false,
}: Props) {
  const { i18n, t } = useTranslation();
  const current = SUPPORTED_LANGS.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGS[0];

  const change = (code: string) => {
    if (code === i18n.language) return;
    i18n.changeLanguage(code).then(() => {
      toast.success(i18n.t("common.saved"));
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size}
          className={compactOnMobile ? "h-9 w-9 gap-2 px-0 sm:h-8 sm:w-auto sm:px-3" : "gap-2"}
          aria-label={`${t("lang.switch")}: ${current.nativeLabel}`}
          title={`${t("lang.switch")}: ${current.nativeLabel}`}>
          <Languages size={16} aria-hidden="true" />
          {showLabel && <span className={compactOnMobile ? "hidden text-xs sm:inline" : "text-xs"}>{current.nativeLabel}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        <DropdownMenuLabel className="text-xs">{t("lang.switch")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LANGS.map((l) => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => change(l.code)}
            className={l.code === current.code ? "bg-primary/10 text-primary font-semibold" : ""}
          >
            <span className="flex-1">{l.nativeLabel}</span>
            {l.code === current.code && <span className="text-[10px]">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
