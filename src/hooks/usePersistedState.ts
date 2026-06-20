import { useEffect, useState } from "react";

/** حالة محفوظة في localStorage (للفلاتر، إعدادات التبويب، إلخ). */
export function usePersistedState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* ignore */
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore quota */
    }
  }, [key, state]);

  return [state, setState] as const;
}
