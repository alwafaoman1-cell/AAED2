import { createStore } from "./createStore";

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  notes?: string;
  /** ماركات السيارات التي يبيع لها المورد قطعها (مثال: ["تويوتا","نيسان","هوندا"]) */
  vehicleBrands?: string[];
  /** فئة عامة (مثال: "وكيل أصلي"، "تجاري"، "مستعمل"، "زيوت") */
  category?: string;
  createdAt: string;
}

export const suppliersStore = createStore<Supplier>({
  key: "alwafa_suppliers_v1",
  seed: [
    { id: "SUP-001", name: "الوكيل تويوتا", phone: "92000001", email: "toyota@dealer.om", address: "مسقط - السيب", taxNumber: "OM100200300", notes: "قطع أصلية", vehicleBrands: ["تويوتا","لكزس"], category: "وكيل أصلي", createdAt: new Date().toISOString() },
    { id: "SUP-002", name: "ACDelco الخليج", phone: "92000002", address: "الخوض", taxNumber: "OM200300400", notes: "بطاريات وقطع كهرباء", vehicleBrands: ["شيفروليه","جي إم سي","كاديلاك"], category: "كهرباء", createdAt: new Date().toISOString() },
    { id: "SUP-003", name: "محلات بريمبو", phone: "92000003", address: "الرسيل", notes: "فرامل ومساعدات", vehicleBrands: ["تويوتا","هوندا","نيسان","لكزس"], category: "فرامل/تعليق", createdAt: new Date().toISOString() },
    { id: "SUP-004", name: "هندي اويل", phone: "92000004", address: "روي", notes: "زيوت وفلاتر", vehicleBrands: ["جميع الماركات"], category: "زيوت", createdAt: new Date().toISOString() },
  ],
});

/** يبحث عن موردين يبيعون ماركة سيارة معينة. */
export function findSuppliersForBrand(brand: string): Supplier[] {
  const b = brand.trim().toLowerCase();
  if (!b) return [];
  return suppliersStore.getAll().filter((s) =>
    (s.vehicleBrands || []).some(
      (vb) => vb.toLowerCase() === b || vb.includes("جميع"),
    ),
  );
}
