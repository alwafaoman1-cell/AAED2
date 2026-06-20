import { createStore } from "./createStore";

export interface Part {
  id: string;
  name: string;
  partNumber: string;
  supplier: string;
  buyPrice: number;     // متوسط مرجّح للتكلفة (Weighted Average Cost)
  sellPrice: number;
  stock: number;
  minStock: number;
  sold: number;
  // الحقول الجديدة (اختيارية للحفاظ على التوافق)
  brand?: string;
  category?: string;
  barcode?: string;
  imageUrl?: string;
  location?: string;     // موقع/رف في المستودع
  status?: "active" | "inactive";
  nameEn?: string;        // الاسم بالإنجليزي
  vehicleMake?: string;   // ماركة السيارة المستهدفة
  vehicleModel?: string;  // موديل السيارة المستهدف
}

export const inventoryStore = createStore<Part>({
  key: "alwafa_inventory_v1",
  seed: [
    { id: "PRT-001", name: "فلتر زيت تويوتا", partNumber: "TOY-OF-001", supplier: "الوكيل", buyPrice: 25, sellPrice: 45, stock: 3, minStock: 5, sold: 120, brand: "Toyota", category: "فلاتر", barcode: "6291100000018", status: "active" },
    { id: "PRT-002", name: "بطارية 70 أمبير", partNumber: "BAT-70A-002", supplier: "ACDelco", buyPrice: 280, sellPrice: 420, stock: 8, minStock: 3, sold: 45, brand: "ACDelco", category: "كهرباء", barcode: "6291100000025", status: "active" },
    { id: "PRT-003", name: "تيل فرامل أمامي كامري", partNumber: "BRK-CAM-003", supplier: "بريمبو", buyPrice: 120, sellPrice: 220, stock: 12, minStock: 5, sold: 85, brand: "Brembo", category: "فرامل", barcode: "6291100000032", status: "active" },
    { id: "PRT-004", name: "مساعد أمامي أكورد", partNumber: "SHK-ACC-004", supplier: "KYB", buyPrice: 350, sellPrice: 550, stock: 2, minStock: 4, sold: 30, brand: "KYB", category: "تعليق", barcode: "6291100000049", status: "active" },
    { id: "PRT-005", name: "فلتر هواء باترول", partNumber: "NIS-AF-005", supplier: "الوكيل", buyPrice: 35, sellPrice: 65, stock: 15, minStock: 5, sold: 60, brand: "Nissan", category: "فلاتر", barcode: "6291100000056", status: "active" },
  ],
});

/**
 * تحديث تكلفة الصنف باستخدام صيغة المتوسط المرجّح:
 *   newAvg = ((oldStock × oldCost) + (incomingQty × incomingCost)) / (oldStock + incomingQty)
 * إذا كان المخزون 0 أو سالب، تُعتمد تكلفة الفاتورة الواردة مباشرة.
 */
export function applyWeightedAverageCost(
  partId: string,
  incomingQty: number,
  incomingCost: number,
): { newStock: number; newAvgCost: number } | null {
  const part = inventoryStore.getById(partId);
  if (!part || incomingQty <= 0) return null;

  const oldStock = Math.max(0, part.stock);
  const oldCost = part.buyPrice || 0;
  const totalQty = oldStock + incomingQty;

  const newAvgCost =
    totalQty > 0
      ? (oldStock * oldCost + incomingQty * incomingCost) / totalQty
      : incomingCost;

  const newStock = part.stock + incomingQty;
  inventoryStore.update(partId, {
    stock: newStock,
    buyPrice: Number(newAvgCost.toFixed(3)),
  });
  return { newStock, newAvgCost };
}

/**
 * إنقاص المخزون (للمرتجعات أو البيع). لا يغيّر متوسط التكلفة.
 */
export function reduceStock(partId: string, qty: number): boolean {
  const part = inventoryStore.getById(partId);
  if (!part || qty <= 0) return false;
  inventoryStore.update(partId, { stock: Math.max(0, part.stock - qty) });
  return true;
}

/** البحث عن صنف عبر الباركود */
export function findByBarcode(barcode: string): Part | undefined {
  if (!barcode) return undefined;
  return inventoryStore.getAll().find((p) => p.barcode === barcode);
}

/** قائمة فريدة من الماركات/التصنيفات */
export function getInventoryFacets() {
  const list = inventoryStore.getAll();
  const brands = Array.from(new Set(list.map((p) => p.brand).filter(Boolean))) as string[];
  const categories = Array.from(new Set(list.map((p) => p.category).filter(Boolean))) as string[];
  return { brands, categories };
}
