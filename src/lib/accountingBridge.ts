// ربط محاسبي تلقائي عام — يُستدعى مرة واحدة عند بدء التطبيق
// يستمع لتغيرات المصاريف ويعيد ترحيلها في دفتر اليومية.
// كذلك: يؤرشف السيارات تلقائياً عند إغلاق/تسليم آخر أمر عمل.
import { expensesStore } from "./expensesStore";
import { postExpense, removeExpenseJournal } from "./salesAccounting";
import { removeJournalBySource, journalStore } from "./journalStore";
import { getWorkOrders, subscribeWorkOrders } from "./workOrdersStore";
import { archiveVehicleByPlate, vehiclesStore } from "./vehiclesStore";

let started = false;
const knownIds = new Set<string>();

const CLOSED_STATUSES = new Set(["مغلق", "تم التسليم", "جاهز للتسليم"]);

function syncExpensesToJournal() {
  const all = expensesStore.getAll();
  const currentIds = new Set(all.map((e) => e.id));

  // ترحيل/تحديث القيود لكل مصروف موجود
  for (const e of all) {
    const m = (e.paymentMethod || "").toString().toLowerCase();
    const paidFrom = m.includes("bank") || m.includes("بنك") ? "bank" : "cash";
    postExpense({
      expenseId: e.id,
      expenseNumber: e.voucherNumber || `EXP-${e.id.slice(0, 6)}`,
      date: e.date || e.createdAt || new Date().toISOString(),
      amount: Number(e.amount || 0),
      category: e.categoryName || e.categoryId || "مصروف",
      paidFrom,
      description: e.description,
    });
    knownIds.add(e.id);
  }

  // إزالة قيود المصاريف المحذوفة
  for (const id of Array.from(knownIds)) {
    if (!currentIds.has(id)) {
      removeExpenseJournal(id);
      knownIds.delete(id);
    }
  }
}

/** أرشفة تلقائية للسيارات التي كل أوامر العمل المرتبطة بها مغلقة/مسلمة */
function syncVehicleArchive() {
  const orders = getWorkOrders();
  const vehicles = vehiclesStore.getAll();
  // نجمع لكل لوحة: هل لها أي أمر عمل غير مغلق؟
  const platesWithActive = new Set<string>();
  const platesWithAny = new Set<string>();
  for (const o of orders) {
    if (!o.plate) continue;
    platesWithAny.add(o.plate);
    if (!CLOSED_STATUSES.has(o.status)) {
      platesWithActive.add(o.plate);
    }
  }
  for (const v of vehicles) {
    const hasAny = platesWithAny.has(v.plate);
    const hasActive = platesWithActive.has(v.plate);
    // إذا كل أوامرها مغلقة → أرشف
    if (hasAny && !hasActive && !v.archived) {
      archiveVehicleByPlate(v.plate, "تم إغلاق/تسليم جميع أوامر العمل");
    }
    // إذا فُتح أمر عمل جديد → إرجاع تلقائي من الأرشيف
    if (hasActive && v.archived) {
      vehiclesStore.update(v.id, { archived: false, archivedAt: undefined, archivedReason: undefined });
    }
  }
}

export function startAccountingBridge() {
  if (started) return;
  started = true;

  // ترحيل أولي
  syncExpensesToJournal();
  syncVehicleArchive();

  // تحديث عند أي تغير
  expensesStore.subscribe(() => {
    try { syncExpensesToJournal(); } catch (e) { console.warn("accountingBridge: expense sync failed", e); }
  });

  subscribeWorkOrders(() => {
    try { syncVehicleArchive(); } catch (e) { console.warn("accountingBridge: vehicle archive sync failed", e); }
  });
}

/** يُستخدم في صفحة دفتر اليومية لمعاينة عدد القيود الحالية */
export function getJournalEntriesCount(): number {
  return journalStore.getAll().length;
}

export { removeJournalBySource };
