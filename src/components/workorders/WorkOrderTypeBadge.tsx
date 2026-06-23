import { Car, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolveWorkOrderType,
  workOrderTypeLabel,
  type WorkOrderTypeSource,
} from "@/lib/workOrderType";

interface Props extends WorkOrderTypeSource {
  compact?: boolean;
  className?: string;
}

export default function WorkOrderTypeBadge({ compact = false, className, ...order }: Props) {
  const type = resolveWorkOrderType(order);
  const Icon = type === "insurance" ? Shield : Car;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold whitespace-nowrap",
        type === "insurance"
          ? "border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-300"
          : "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        className,
      )}
    >
      <Icon size={compact ? 11 : 13} />
      {workOrderTypeLabel(type, compact)}
    </span>
  );
}
