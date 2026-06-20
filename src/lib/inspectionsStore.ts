import { createStore } from "./createStore";

export interface InspectionRecord {
  id: string;
  workOrder: string;
  customer: string;
  vehicle: string;
  date: string;
  damageType: string;
  photos: number;
  status: string;
  /** Kind of inspection: general (bilingual) or insurance (Al Madina style, English-only) */
  kind?: "general" | "insurance";
  /** رقم اللوحة — يستخدم لمنع تكرار الفحوصات لنفس السيارة */
  plate?: string;
}

/** يطبّع رقم اللوحة لمقارنات قوية (يزيل الفراغات والشرطات ويحوّل لأحرف صغيرة) */
export function normalizePlate(p?: string): string {
  return (p || "").replace(/[\s\-_]+/g, "").trim().toLowerCase();
}

/** يبحث عن فحص قائم لنفس السيارة (نفس النوع general/insurance) */
export function findInspectionByPlate(plate: string, kind: "general" | "insurance" = "general"): InspectionRecord | undefined {
  const np = normalizePlate(plate);
  if (!np) return undefined;
  return inspectionsStore.getAll().find((i) =>
    (i.kind || "general") === kind && normalizePlate(i.plate || i.vehicle) === np
  );
}

export const inspectionsStore = createStore<InspectionRecord>({
  key: "alwafa_inspections_v1",
  seed: [
    { id: "INS-001", workOrder: "WO-2024-001", customer: "أحمد محمد", vehicle: "تويوتا كامري 2023", date: "2024-03-25", damageType: "أمامي + ميكانيكي", photos: 12, status: "مكتمل" },
    { id: "INS-002", workOrder: "WO-2024-004", customer: "فهد السبيعي", vehicle: "لكزس ES 2023", date: "2024-03-27", damageType: "كهربائي", photos: 5, status: "قيد الفحص" },
    { id: "INS-003", workOrder: "WO-2024-005", customer: "محمد الشمري", vehicle: "شيفروليه تاهو 2024", date: "2024-03-28", damageType: "جانبي + شاصي", photos: 18, status: "مكتمل" },
  ],
});
