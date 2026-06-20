import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VEHICLE_COLORS, findVehicleColor } from "@/lib/vehicleColors";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** قائمة منسدلة بكل ألوان السيارات مع معاينة لونية */
export default function VehicleColorSelect({ value, onChange, placeholder = "اختر اللون", className }: Props) {
  const current = findVehicleColor(value);
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder}>
          {value && (
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border border-border shrink-0"
                style={{ backgroundColor: current?.hex || "#999" }}
              />
              <span>{current?.ar || value}</span>
              {current?.en && <span className="text-[10px] text-muted-foreground">({current.en})</span>}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {VEHICLE_COLORS.map((c) => (
          <SelectItem key={c.ar} value={c.ar}>
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border border-border shrink-0"
                style={{ backgroundColor: c.hex }}
              />
              <span>{c.ar}</span>
              <span className="text-[10px] text-muted-foreground">({c.en})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
