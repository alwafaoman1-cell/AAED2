// قائمة موحّدة لألوان السيارات (عربي + إنجليزي + لون hex للمعاينة)
export interface VehicleColor {
  ar: string;
  en: string;
  hex: string;
}

export const VEHICLE_COLORS: VehicleColor[] = [
  { ar: "أبيض", en: "White", hex: "#ffffff" },
  { ar: "أسود", en: "Black", hex: "#0a0a0a" },
  { ar: "فضي", en: "Silver", hex: "#c0c0c0" },
  { ar: "رمادي", en: "Gray", hex: "#808080" },
  { ar: "رمادي فاتح", en: "Light Gray", hex: "#b8b8b8" },
  { ar: "رمادي غامق", en: "Dark Gray", hex: "#4a4a4a" },
  { ar: "أحمر", en: "Red", hex: "#d32f2f" },
  { ar: "أحمر داكن", en: "Dark Red / Maroon", hex: "#7b1f1f" },
  { ar: "بورجوندي", en: "Burgundy", hex: "#800020" },
  { ar: "أزرق", en: "Blue", hex: "#1976d2" },
  { ar: "أزرق فاتح", en: "Light Blue", hex: "#64b5f6" },
  { ar: "أزرق غامق / كحلي", en: "Navy Blue", hex: "#0d1b4d" },
  { ar: "تركواز", en: "Turquoise", hex: "#26a69a" },
  { ar: "أخضر", en: "Green", hex: "#2e7d32" },
  { ar: "أخضر فاتح", en: "Light Green", hex: "#81c784" },
  { ar: "أخضر غامق", en: "Dark Green", hex: "#1b3a1b" },
  { ar: "أخضر زيتي", en: "Olive", hex: "#556b2f" },
  { ar: "أصفر", en: "Yellow", hex: "#fbc02d" },
  { ar: "ذهبي", en: "Gold", hex: "#caa84c" },
  { ar: "برتقالي", en: "Orange", hex: "#f57c00" },
  { ar: "بني", en: "Brown", hex: "#5d4037" },
  { ar: "بيج", en: "Beige", hex: "#d7c5a0" },
  { ar: "كريمي", en: "Cream", hex: "#f3e7c9" },
  { ar: "شمبانيا", en: "Champagne", hex: "#e3d4b3" },
  { ar: "نحاسي", en: "Bronze", hex: "#9c6b3c" },
  { ar: "وردي", en: "Pink", hex: "#ec407a" },
  { ar: "بنفسجي", en: "Purple", hex: "#7b3aa0" },
  { ar: "رصاصي / جرافيت", en: "Graphite", hex: "#383838" },
  { ar: "مطفي (مات أسود)", en: "Matte Black", hex: "#1a1a1a" },
  { ar: "كروم", en: "Chrome", hex: "#d8dde0" },
  { ar: "ثنائي اللون", en: "Two-Tone", hex: "#cccccc" },
  { ar: "آخر", en: "Other", hex: "#999999" },
];

export function findVehicleColor(value: string | null | undefined): VehicleColor | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return VEHICLE_COLORS.find(
    (c) => c.ar.toLowerCase() === v || c.en.toLowerCase() === v
  );
}

/** يُرجع اسم اللون بالإنجليزية إن أمكن المطابقة، وإلا يُرجع القيمة كما هي. */
export function vehicleColorToEn(value: string | null | undefined): string {
  if (!value) return "";
  return findVehicleColor(value)?.en ?? value;
}
