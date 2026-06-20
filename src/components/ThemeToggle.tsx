import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme, Theme } from "@/contexts/ThemeContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export default function ThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();

  const Icon = resolved === "dark" ? Moon : Sun;

  const items: { value: Theme; label: string; icon: React.ElementType }[] = [
    { value: "light", label: "فاتح", icon: Sun },
    { value: "dark", label: "داكن", icon: Moon },
    { value: "system", label: "تلقائي", icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="تبديل المظهر">
          <Icon className="h-4 w-4" />
          <span className="sr-only">تبديل المظهر</span>
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
