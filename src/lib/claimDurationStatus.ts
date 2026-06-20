// نظام ألوان موحّد لمدة بقاء السيارة في الورشة / عمر المطالبة.
//   0-10  ⇒ أخضر  (طبيعي)
//  11-20  ⇒ برتقالي (تحذير)
//  21-30  ⇒ أصفر (متأخر بسيط)
//  > 30   ⇒ أحمر (متأخر)
//
// يُستخدم في تقرير عمليات الورشة، قوائم المطالبات، ولوحات KPI.

export type DurationLevel = "green" | "orange" | "yellow" | "red";

export function durationLevel(days: number | null | undefined): DurationLevel {
  const d = Number(days);
  if (!isFinite(d) || d <= 0) return "green";
  if (d > 30) return "red";
  if (d >= 21) return "yellow";
  if (d >= 11) return "orange";
  return "green";
}

/** Tailwind classes for badges/cells in the in-app UI. */
export function durationBadgeClass(level: DurationLevel): string {
  switch (level) {
    case "red":    return "bg-destructive/15 text-destructive border-destructive/40";
    case "yellow": return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/40";
    case "orange": return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40";
    case "green":  return "bg-success/15 text-success border-success/40";
  }
}

/** Hex colors for inline PDF / printed templates. */
export function durationHex(level: DurationLevel): { bg: string; fg: string } {
  switch (level) {
    case "red":    return { bg: "#fee2e2", fg: "#b91c1c" };
    case "yellow": return { bg: "#fef9c3", fg: "#a16207" };
    case "orange": return { bg: "#ffedd5", fg: "#c2410c" };
    case "green":  return { bg: "#dcfce7", fg: "#15803d" };
  }
}

export function durationLabel(level: DurationLevel, isAr = true): string {
  if (isAr) {
    return { green: "طبيعي", orange: "تحذير", yellow: "متأخر", red: "متأخر جداً" }[level];
  }
  return { green: "Normal", orange: "Warning", yellow: "Late", red: "Overdue" }[level];
}

/** Days between start and (end ?? today), floored to ≥ 0. Returns null if start invalid. */
export function computeDays(start?: string | null, end?: string | null): number | null {
  if (!start) return null;
  const s = new Date(start).getTime();
  if (!isFinite(s)) return null;
  const e = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.round((e - s) / 86_400_000));
}
