// نظام الإذن المخزنية: إدخال (IN) / إخراج (OUT) / تحويل (TRANSFER)
import { createStore } from "./createStore";
import { inventoryStore } from "./inventoryStore";

export type MovementType = "IN" | "OUT" | "TRANSFER";

export interface StockMovementItem {
  partId: string;
  partName: string;
  partNumber: string;
  qty: number;
  unitCost?: number; // للإدخال فقط
}

export interface StockMovement {
  id: string;             // SM-00001
  type: MovementType;
  date: string;           // ISO yyyy-mm-dd
  reference?: string;     // رقم مرجعي خارجي
  reason: string;         // سبب الحركة
  fromLocation?: string;  // للإخراج/التحويل
  toLocation?: string;    // للإدخال/التحويل
  items: StockMovementItem[];
  notes?: string;
  createdBy?: string;
  createdAt: string;
}

export const stockMovementsStore = createStore<StockMovement>({
  key: "alwafa_stock_movements_v1",
  seed: [],
});

export function nextStockMovementId(): string {
  const list = stockMovementsStore.getAll();
  return `SM-${String(list.length + 1).padStart(5, "0")}`;
}

/** تطبيق حركة المخزون فعلياً على inventoryStore */
export function applyStockMovement(m: StockMovement): { ok: boolean; error?: string } {
  // تحقق من توفر الكمية للإخراج/التحويل
  if (m.type === "OUT" || m.type === "TRANSFER") {
    for (const it of m.items) {
      const part = inventoryStore.getById(it.partId);
      if (!part) return { ok: false, error: `الصنف ${it.partName} غير موجود` };
      if (part.stock < it.qty) {
        return { ok: false, error: `الكمية المتوفرة من ${it.partName} غير كافية (المتاح: ${part.stock})` };
      }
    }
  }

  // تنفيذ الحركة
  m.items.forEach((it) => {
    const part = inventoryStore.getById(it.partId);
    if (!part) return;

    if (m.type === "IN") {
      // إدخال: زيادة الكمية + تحديث المتوسط المرجح إن وُجدت تكلفة
      const oldStock = Math.max(0, part.stock);
      const oldCost = part.buyPrice || 0;
      const incomingCost = it.unitCost ?? oldCost;
      const totalQty = oldStock + it.qty;
      const newAvg = totalQty > 0
        ? (oldStock * oldCost + it.qty * incomingCost) / totalQty
        : incomingCost;
      inventoryStore.update(part.id, {
        stock: part.stock + it.qty,
        buyPrice: Number(newAvg.toFixed(3)),
        location: m.toLocation || part.location,
      });
    } else if (m.type === "OUT") {
      inventoryStore.update(part.id, {
        stock: Math.max(0, part.stock - it.qty),
      });
    } else if (m.type === "TRANSFER") {
      // التحويل لا يغير الكمية الإجمالية، فقط الموقع
      inventoryStore.update(part.id, {
        location: m.toLocation || part.location,
      });
    }
  });

  return { ok: true };
}

/** عكس الحركة (للحذف) */
export function reverseStockMovement(m: StockMovement) {
  m.items.forEach((it) => {
    const part = inventoryStore.getById(it.partId);
    if (!part) return;
    if (m.type === "IN") {
      inventoryStore.update(part.id, { stock: Math.max(0, part.stock - it.qty) });
    } else if (m.type === "OUT") {
      inventoryStore.update(part.id, { stock: part.stock + it.qty });
    }
    // TRANSFER لا يحتاج عكس للكمية
  });
}
