import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { AlertCircle } from "lucide-react";
import {
  extractPlateDigits,
  extractPlateLetters,
  formatPlate,
  parseFullPlate,
  findVehicleByPlate,
} from "@/lib/plateUtils";

interface Props {
  /** Combined display value (legacy). Parent stores it as a single string. */
  value: string;
  /** Called with canonical combined string "AA 12345" */
  onChange: (combined: string) => void;
  /** Optional callback with parsed parts (letters, digits, country). */
  onPartsChange?: (parts: { letters: string; digits: string; country: string }) => void;
  /** Default country (default "OM") */
  defaultCountry?: string;
  /** Show country field (default true) */
  showCountry?: boolean;
  /** Enable live cloud duplicate detection (default true) */
  checkDuplicate?: boolean;
  /** Exclude duplicate result when its id matches (used while editing the same record) */
  excludeId?: string;
  /** Compact layout (single row) */
  compact?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Unified license-plate input — splits into (letters, digits, country)
 * and reports the canonical combined display string upward.
 */
export default function PlateInput({
  value,
  onChange,
  onPartsChange,
  defaultCountry = "OM",
  showCountry = false,
  checkDuplicate = true,
  excludeId,
  compact = false,
  disabled,
}: Props) {
  // Seed from incoming combined value once per mount, then sync on external changes.
  const seed = useMemo(() => parseFullPlate(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [letters, setLetters] = useState(seed.letters);
  const [digits, setDigits] = useState(seed.digits);
  const [country, setCountry] = useState(defaultCountry);
  const [dup, setDup] = useState<null | Awaited<ReturnType<typeof findVehicleByPlate>>>(null);

  // Reconcile when parent passes a different value externally.
  useEffect(() => {
    const p = parseFullPlate(value);
    if (p.letters !== letters || p.digits !== digits) {
      setLetters(p.letters);
      setDigits(p.digits);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Emit canonical combined value upward whenever parts change.
  useEffect(() => {
    const combined = formatPlate({ plate_letters: letters, plate_number: digits });
    const safe = combined === "—" ? "" : combined;
    if (safe !== value) onChange(safe);
    onPartsChange?.({ letters, digits, country });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letters, digits, country]);

  // Live duplicate lookup
  useEffect(() => {
    if (!checkDuplicate) { setDup(null); return; }
    if (!letters || !digits) { setDup(null); return; }
    const t = setTimeout(async () => {
      const f = await findVehicleByPlate(letters, digits, country);
      if (f && excludeId && f.id === excludeId) { setDup(null); return; }
      setDup(f);
    }, 350);
    return () => clearTimeout(t);
  }, [letters, digits, country, checkDuplicate, excludeId]);

  return (
    <div className={compact ? "flex items-end gap-2" : "space-y-2"}>
      <div className={compact ? "flex gap-2 flex-1" : "grid grid-cols-2 gap-2"}>
        <div className="space-y-1 flex-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">الأرقام</label>
          <Input
            value={digits}
            onChange={(e) => setDigits(extractPlateDigits(e.target.value))}
            inputMode="numeric"
            dir="ltr"
            placeholder="12345"
            maxLength={7}
            disabled={disabled}
            className="bg-secondary border-border font-mono text-center"
          />
        </div>
        <div className="space-y-1 flex-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">الحروف (EN)</label>
          <Input
            value={letters}
            onChange={(e) => setLetters(extractPlateLetters(e.target.value))}
            dir="ltr"
            placeholder="AA"
            maxLength={4}
            disabled={disabled}
            className="bg-secondary border-border font-mono uppercase text-center"
          />
        </div>
        {showCountry && (
          <div className="space-y-1 w-20">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">الدولة</label>
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 4))}
              dir="ltr"
              placeholder="OM"
              maxLength={4}
              disabled={disabled}
              className="bg-secondary border-border font-mono uppercase text-center"
            />
          </div>
        )}
      </div>
      {(letters || digits) && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
          <span className="text-[10px] text-muted-foreground">العرض الموحد</span>
          <span className="font-mono text-sm font-semibold" dir="ltr">
            {formatPlate({ plate_letters: letters, plate_number: digits })}
          </span>
        </div>
      )}
      {dup && (
        <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>
            مركبة موجودة مسبقاً: {dup.brand} {dup.model} {dup.year ? `(${dup.year})` : ""}
            {dup.archived ? " — مؤرشفة" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
