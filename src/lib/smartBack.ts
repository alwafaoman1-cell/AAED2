import type { NavigateFunction } from "react-router-dom";

/**
 * يعود للصفحة السابقة في تاريخ المتصفح إن وُجدت،
 * وإلا يذهب إلى المسار الاحتياطي.
 */
export function smartBack(navigate: NavigateFunction, fallback: string = "/") {
  // إن كان هناك سجل تنقل سابق داخل التطبيق نفسه، عُد له
  // (window.history.length > 1 يدل على وجود إدخال سابق)
  try {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }
  } catch {
    /* ignore */
  }
  navigate(fallback);
}
