// ============================================================
// Demo Seeder — تنظيف كامل للبيانات التجريبية
// تمت إزالة كل بيانات الاختبار. النظام يبدأ فارغاً تماماً.
// كل المتاجر يتم تثبيتها على [] حتى لا تُحمّل بيانات seed الافتراضية.
// ============================================================

const SEED_VERSION_KEY = "alwafa_demo_seed_version";
const CURRENT_VERSION = "v4-clean-start-2026-05-03";

// كل مفاتيح المتاجر (createStore) — تُفرَّغ بالكامل
const ALL_STORE_KEYS = [
  "alwafa_customers_v1",
  "alwafa_work_orders",
  "alwafa_vehicles_v2",
  "alwafa_sales_docs_v1",
  "alwafa_inspections_v1",
  "alwafa_deposits_v1",
  "alwafa_expenses_v1",
  "alwafa_inventory_v1",
  "alwafa_appointments_v1",
  "alwafa_credit_notes_v1",
  "alwafa_journal_v1",
  "alwafa_audit_log_v1",
  "alwafa_trash_v1",
  "alwafa_wa_message_logs",
  "alwafa_staff_v1",
  "alwafa_users_v1",
  "alwafa_suppliers_v1",
  "alwafa_purchase_invoices_v1",
  "alwafa_purchase_returns_v1",
  "alwafa_supplier_payments_v1",
  "alwafa_stock_movements_v1",
];

export function runDemoSeederIfNeeded() {
  if (typeof window === "undefined") return;
  try {
    const current = localStorage.getItem(SEED_VERSION_KEY);
    if (current === CURRENT_VERSION) return;

    // تفريغ كل المتاجر بمصفوفات فارغة (يمنع تحميل بيانات seed الافتراضية)
    ALL_STORE_KEYS.forEach((k) => {
      try { localStorage.setItem(k, "[]"); } catch {}
    });

    localStorage.setItem(SEED_VERSION_KEY, CURRENT_VERSION);

    // eslint-disable-next-line no-console
    console.info("[DemoSeeder] ✅ تم مسح جميع البيانات التجريبية — بداية نظيفة.");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[DemoSeeder] فشل التنظيف:", err);
  }
}
