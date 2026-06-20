import { Badge } from "@/components/ui/badge";
import { statusBadgeClasses } from "@/lib/statusColors";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status?: string | null;
  label?: string;
  className?: string;
}

/**
 * Drop-in unified status badge that picks colors from the design system
 * via statusBadgeClasses(). Use everywhere instead of ad-hoc colored badges.
 */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <Badge variant="outline" className={cn("border", statusBadgeClasses(status), className)}>
      {label ?? status ?? "—"}
    </Badge>
  );
}
