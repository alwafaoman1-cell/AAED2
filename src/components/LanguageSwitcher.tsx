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
}

/**
 * Compact language switcher used in the sidebar / header.
 * Persists choice automatically (i18next localStorage detector).
 */
export default function LanguageSwitcher({
  variant = "ghost",
  size = "sm",
  showLabel = true,
}: Props) {
  const { i18n, t } = useTranslation();
  const current = SUPPORTED_LANGS.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGS[0];

  const change = (code: string) => {
    if (code === i18n.language) return;
    i18n.changeLanguage(code).then(() => {
      toast.success(t("common.saved"));
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className="gap-2">
          <Languages size={16} />
          {showLabel && <span className="text-xs">{current.nativeLabel}</span>}
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
