export interface UplItem {
  description: string;
  quantity: number;
  unit_price: number;
}

export const DEFAULT_UPL_ITEMS: UplItem[] = [
  { description: "قطع الغيار / Spare Parts", quantity: 1, unit_price: 0 },
  { description: "أجرة العمالة / Labour Charges", quantity: 1, unit_price: 0 },
];
