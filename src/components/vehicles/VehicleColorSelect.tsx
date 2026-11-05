import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VEHICLE_COLORS, findVehicleColor } from "@/lib/vehicleColors";
import {useTranslation} from "react-i18next";
import "@/lib/i18n/vehicleIdentityFields";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** قائمة منسدلة بكل ألوان السيارات مع معاينة لونية */
export default function VehicleColorSelect({ value, onChange, placeholder, className }: Props) {
  const {t,i18n}=useTranslation();
  const isEnglish=i18n.language.startsWith("en");
  const current = findVehicleColor(value);
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger aria-label={t("vehicleIdentityFields.color")} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder || t("vehicleIdentityFields.chooseColor")}>
          {value && (
            <span className="inline-flex items-center gap-2">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border border-border shrink-0"
                style={{ backgroundColor: current?.hex || "#999" }}
              />
              <span>{(isEnglish?current?.en:current?.ar) || value}</span>
              {!isEnglish && current?.en && <span className="text-xs text-muted-foreground">({current.en})</span>}
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
              <span>{isEnglish?c.en:c.ar}</span>
              {!isEnglish && <span className="text-xs text-muted-foreground">({c.en})</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
