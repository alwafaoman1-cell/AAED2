// Reusable bulk-selection hook for list pages.
// تحديد جماعي + إجراءات (حذف/تصدير/تغيير حالة).
import { useCallback, useMemo, useState } from "react";

export function useBulkSelection<T extends { id: string }>(items: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allIds = useMemo(() => items.map((i) => i.id), [items]);
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = !allChecked && allIds.some((id) => selected.has(id));

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const allOn = allIds.length > 0 && allIds.every((id) => prev.has(id));
      if (allOn) {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      allIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id)),
    [items, selected],
  );

  return {
    selected,
    selectedIds: Array.from(selected),
    selectedItems,
    count: selected.size,
    isSelected: (id: string) => selected.has(id),
    toggle,
    toggleAll,
    allChecked,
    someChecked,
    clear,
  };
}

/** Export rows as CSV with BOM for Excel UTF-8. */
export function exportRowsAsCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv =
    "\uFEFF" +
    [header, ...rows]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
