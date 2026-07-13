import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Plus, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useVehicleMakes, useVehicleModels, useCreateMake, useCreateModel,
} from "@/hooks/useVehicleMakesModels";
import VinScannerButton from "@/components/scanner/VinScannerButton";
import VehicleColorSelect from "@/components/vehicles/VehicleColorSelect";
import PlateInput from "@/components/vehicles/PlateInput";

interface Props {
  make: string;
  model: string;
  plate: string;
  year?: string;
  color?: string;
  vin?: string;
  onChange: (patch: { make?: string; model?: string; plate?: string; year?: string; color?: string; vin?: string }) => void;
  className?: string;
  /** Hide specific fields to avoid duplication when the parent renders them separately. */
  hideFields?: Array<"plate" | "year" | "color" | "vin">;
}

export default function VehicleMakeModelPicker({
  make, model, plate, year = "", color = "", vin = "", onChange, className, hideFields = [],
}: Props) {
  const hidden = (k: "plate" | "year" | "color" | "vin") => hideFields.includes(k);
  const [openMake, setOpenMake] = useState(false);
  const [openModel, setOpenModel] = useState(false);
  const [makeQuery, setMakeQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");

  const { data: makes = [] } = useVehicleMakes();
  // المطابقة تتم على الاسم الإنجليزي primary، مع استرجاع للعربي للسجلات القديمة
  const selectedMake = useMemo(
    () => makes.find((m) => m.name === make || (m.name_ar && m.name_ar === make)),
    [makes, make]
  );
  const equivalentMakeIds = useMemo(() => {
    if (!selectedMake) return [];
    const selectedNames = new Set(
      [selectedMake.name, selectedMake.name_ar].filter(Boolean).map((v) => String(v).trim().toLowerCase())
    );
    return makes
      .filter((m) => {
        const names = [m.name, m.name_ar].filter(Boolean).map((v) => String(v).trim().toLowerCase());
        return names.some((v) => selectedNames.has(v));
      })
      .map((m) => m.id);
  }, [makes, selectedMake]);
  const { data: models = [] } = useVehicleModels(equivalentMakeIds.length ? equivalentMakeIds : null);
  const createMake = useCreateMake();
  const createModel = useCreateModel();

  const filteredMakes = useMemo(() => {
    const q = makeQuery.trim().toLowerCase();
    if (!q) return makes;
    return makes.filter((m) =>
      m.name.toLowerCase().includes(q) || (m.name_ar || "").toLowerCase().includes(q)
    );
  }, [makes, makeQuery]);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) =>
      m.name.toLowerCase().includes(q) || (m.name_ar || "").toLowerCase().includes(q)
    );
  }, [models, modelQuery]);

  const showAddMake = makeQuery.trim() && !filteredMakes.some(
    (m) => m.name.toLowerCase() === makeQuery.trim().toLowerCase() ||
           (m.name_ar || "").toLowerCase() === makeQuery.trim().toLowerCase()
  );
  const showAddModel = modelQuery.trim() && selectedMake && !filteredModels.some(
    (m) => m.name.toLowerCase() === modelQuery.trim().toLowerCase() ||
           (m.name_ar || "").toLowerCase() === modelQuery.trim().toLowerCase()
  );

  const handleAddMake = async () => {
    const name = makeQuery.trim();
    if (!name) return;
    const created = await createMake.mutateAsync(name);
    // نحفظ الاسم الإنجليزي primary
    onChange({ make: created.name, model: "" });
    setMakeQuery("");
    setOpenMake(false);
  };

  const handleAddModel = async () => {
    if (!selectedMake) return;
    const name = modelQuery.trim();
    if (!name) return;
    const created = await createModel.mutateAsync({ makeId: selectedMake.id, name });
    onChange({ model: created.name });
    setModelQuery("");
    setOpenModel(false);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Car className="h-4 w-4" />
        <span>بيانات السيارة (اختياري — تُحفظ مع المطالبة حتى دون ربط مركبة)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Make */}
        <div className="space-y-1.5">
          <Label>الماركة</Label>
          <Popover open={openMake} onOpenChange={setOpenMake}>
            <PopoverTrigger asChild>
              <Button
                variant="outline" role="combobox"
                className="w-full justify-between font-normal"
                style={{ fontFamily: make ? "Inter, sans-serif" : undefined }}
              >
                {make || "اختر الماركة..."}
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="ابحث أو أضف ماركة..."
                  value={makeQuery}
                  onValueChange={setMakeQuery}
                />
                <CommandList>
                  <CommandEmpty>
                    {showAddMake ? (
                      <button
                        onClick={handleAddMake}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                      >
                        <Plus className="h-4 w-4" />
                        إضافة "{makeQuery}"
                      </button>
                    ) : "لا توجد نتائج"}
                  </CommandEmpty>
                  <CommandGroup>
                    {filteredMakes.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.id}
                        onSelect={() => {
                          // نحفظ الإنجليزي primary
                          onChange({ make: m.name, model: "" });
                          setOpenMake(false);
                          setMakeQuery("");
                        }}
                      >
                        <Check className={cn("ml-2 h-4 w-4", make === m.name || make === m.name_ar ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 font-semibold" style={{ fontFamily: "Inter, sans-serif" }}>{m.name}</span>
                        {m.name_ar && <span className="text-xs text-muted-foreground">{m.name_ar}</span>}
                      </CommandItem>
                    ))}
                    {showAddMake && (
                      <CommandItem onSelect={handleAddMake} className="text-primary">
                        <Plus className="ml-2 h-4 w-4" />
                        إضافة "{makeQuery}" كماركة جديدة
                      </CommandItem>
                    )}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Model */}
        <div className="space-y-1.5">
          <Label>الموديل {selectedMake && <span className="text-xs text-muted-foreground">({selectedMake.name})</span>}</Label>
          <Popover open={openModel} onOpenChange={setOpenModel}>
            <PopoverTrigger asChild>
              <Button
                variant="outline" role="combobox" disabled={!make}
                className="w-full justify-between font-normal"
                style={{ fontFamily: model ? "Inter, sans-serif" : undefined }}
              >
                {model || (make ? "اختر الموديل..." : "اختر الماركة أولاً")}
                <ChevronsUpDown className="h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="ابحث أو أضف موديل..."
                  value={modelQuery}
                  onValueChange={setModelQuery}
                />
                <CommandList>
                  <CommandEmpty>
                    {showAddModel ? (
                      <button
                        onClick={handleAddModel}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                      >
                        <Plus className="h-4 w-4" />
                        إضافة "{modelQuery}"
                      </button>
                    ) : "لا توجد موديلات"}
                  </CommandEmpty>
                  <CommandGroup>
                    {filteredModels.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.id}
                        onSelect={() => {
                          onChange({ model: m.name });
                          setOpenModel(false);
                          setModelQuery("");
                        }}
                      >
                        <Check className={cn("ml-2 h-4 w-4", model === m.name || model === m.name_ar ? "opacity-100" : "opacity-0")} />
                        <span className="flex-1 font-semibold" style={{ fontFamily: "Inter, sans-serif" }}>{m.name}</span>
                        {m.name_ar && <span className="text-xs text-muted-foreground">{m.name_ar}</span>}
                      </CommandItem>
                    ))}
                    {showAddModel && (
                      <CommandItem onSelect={handleAddModel} className="text-primary">
                        <Plus className="ml-2 h-4 w-4" />
                        إضافة "{modelQuery}" كموديل جديد
                      </CommandItem>
                    )}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {!hidden("plate") && (
          <div className="space-y-1.5">
            <Label>اللوحة</Label>
            <PlateInput
              value={plate}
              onChange={(value) => onChange({ plate: value })}
              checkDuplicate={false}
            />
          </div>
        )}

        {(!hidden("year") || !hidden("color")) && (
          <div className="grid grid-cols-2 gap-3">
            {!hidden("year") && (
              <div className="space-y-1.5">
                <Label>سنة الصنع</Label>
                <Input value={year} onChange={(e) => onChange({ year: e.target.value })} placeholder="2024" inputMode="numeric" />
              </div>
            )}
            {!hidden("color") && (
              <div className="space-y-1.5">
                <Label>اللون</Label>
                <VehicleColorSelect value={color} onChange={(v) => onChange({ color: v })} />
              </div>
            )}
          </div>
        )}

        {!hidden("vin") && (
          <div className="md:col-span-2 space-y-1.5">
            <Label>رقم الهيكل (VIN)</Label>
            <div className="flex gap-2">
              <Input
                value={vin}
                onChange={(e) => onChange({ vin: e.target.value.toUpperCase() })}
                placeholder="17 خانة"
                dir="ltr"
                className="font-mono"
                maxLength={17}
              />
              <VinScannerButton onResult={({ vin: v, year: y }) => {
                const patch: any = {};
                if (v) patch.vin = v;
                if (y && !year) patch.year = y;
                if (Object.keys(patch).length) onChange(patch);
              }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
