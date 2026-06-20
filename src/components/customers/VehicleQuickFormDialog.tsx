import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { vehiclesStore, type Vehicle } from "@/lib/vehiclesStore";
import { toast } from "sonner";
import VinScannerButton from "@/components/scanner/VinScannerButton";
import {
  extractPlateDigits,
  extractPlateLetters,
  formatPlate,
  validatePlateParts,
  findVehicleByPlate,
} from "@/lib/plateUtils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ownerName: string;
  ownerPhone?: string;
  onSaved?: (v: Vehicle) => void;
}

export default function VehicleQuickFormDialog({ open, onOpenChange, ownerName, ownerPhone, onSaved }: Props) {
  const [plateLetters, setPlateLetters] = useState("");
  const [plateDigits, setPlateDigits] = useState("");
  const [plateCountry, setPlateCountry] = useState("OM");
  const [type, setType] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [duplicate, setDuplicate] = useState<null | Awaited<ReturnType<typeof findVehicleByPlate>>>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) {
      setPlateLetters(""); setPlateDigits(""); setPlateCountry("OM");
      setType(""); setModel(""); setYear("");
      setColor(""); setVin(""); setMileage("");
      setDuplicate(null);
    }
  }, [open]);

  // Live duplicate check (debounced)
  useEffect(() => {
    const L = extractPlateLetters(plateLetters);
    const D = extractPlateDigits(plateDigits);
    if (!L || !D) { setDuplicate(null); return; }
    setChecking(true);
    const t = setTimeout(async () => {
      const found = await findVehicleByPlate(L, D, plateCountry);
      setDuplicate(found);
      setChecking(false);
    }, 350);
    return () => clearTimeout(t);
  }, [plateLetters, plateDigits, plateCountry]);

  const displayPlate = useMemo(
    () => formatPlate({ plate_letters: extractPlateLetters(plateLetters), plate_number: extractPlateDigits(plateDigits) }),
    [plateLetters, plateDigits],
  );

  function save() {
    const L = extractPlateLetters(plateLetters);
    const D = extractPlateDigits(plateDigits);
    const err = validatePlateParts(L, D);
    if (err) { toast.error(err); return; }
    if (duplicate) {
      toast.error("هذه المركبة مسجلة مسبقاً — لا يمكن إنشاء سجل مكرر");
      return;
    }
    // Local-store check (legacy) on the unified display string
    const exists = vehiclesStore.getAll().find((v) => v.plate === displayPlate);
    if (exists) { toast.error("هذه اللوحة مسجلة مسبقاً"); return; }
    const v: Vehicle = {
      id: displayPlate,
      plate: displayPlate,
      type: `${type} ${model}`.trim() || "-",
      vin: vin.trim(),
      owner: ownerName,
      ownerPhone: ownerPhone || "",
      year, color, mileage,
      visits: 0,
      lastVisit: new Date().toISOString().slice(0, 10),
      totalSpent: 0,
      photoPairs: [],
    };
    vehiclesStore.add(v);
    toast.success("تمت إضافة السيارة");
    onSaved?.(v);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة سيارة للعميل {ownerName}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {/* Plate — split fields */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">الأرقام *</Label>
            <Input
              value={plateDigits}
              onChange={(e) => setPlateDigits(extractPlateDigits(e.target.value))}
              inputMode="numeric"
              dir="ltr"
              placeholder="12345"
              maxLength={7}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">الحروف * (إنجليزية)</Label>
            <Input
              value={plateLetters}
              onChange={(e) => setPlateLetters(extractPlateLetters(e.target.value))}
              dir="ltr"
              placeholder="AA"
              maxLength={4}
              className="uppercase"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">صيغة العرض الموحدة</div>
            <div className="font-mono text-lg font-semibold" dir="ltr">{displayPlate}</div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">دولة اللوحة</Label>
            <Input
              value={plateCountry}
              onChange={(e) => setPlateCountry(e.target.value.toUpperCase().slice(0, 4))}
              dir="ltr"
              maxLength={4}
              placeholder="OM"
            />
          </div>

          {duplicate && (
            <div className="sm:col-span-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              <AlertCircle size={16} className="mt-0.5 text-destructive shrink-0" />
              <div className="space-y-1">
                <div className="font-semibold text-destructive">
                  هذه المركبة موجودة مسبقاً في النظام
                </div>
                <div className="text-xs text-muted-foreground">
                  {duplicate.brand} {duplicate.model} {duplicate.year ? `(${duplicate.year})` : ""} —
                  لوحة <span className="font-mono">{formatPlate(duplicate)}</span>
                  {duplicate.archived ? " — (مؤرشفة)" : ""}
                </div>
                <div className="text-xs text-destructive font-medium">
                  لن يُسمح بالحفظ. افتح المركبة الموجودة من شاشة "المركبات".
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">الماركة</Label>
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="تويوتا" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">الموديل</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="كامري" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">سنة الصنع</Label>
            <Input value={year} onChange={(e) => setYear(e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">اللون</Label>
            <Input value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">رقم الهيكل (VIN)</Label>
            <div className="flex gap-2">
              <Input value={vin} onChange={(e) => setVin(e.target.value)} dir="ltr" />
              <VinScannerButton onResult={({ vin: v, year: y }) => {
                if (v) setVin(v);
                if (y && !year) setYear(y);
              }} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">الكيلومترات</Label>
            <Input value={mileage} onChange={(e) => setMileage(e.target.value)} dir="ltr" />
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            onClick={save}
            disabled={!!duplicate || checking}
            className="gradient-gold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {checking ? "جاري التحقق..." : "حفظ السيارة"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
