import { useEffect, useState, type ReactNode } from "react";
import { ThemeContext, type Theme } from "@/contexts/themeContextState";

const STORAGE_KEY = "alwafa_theme_v1";

function getSystem(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyClass(mode: "light" | "dark") {
  const root = document.documentElement;
  // Project base is dark (defined on :root). Add 'light' class to switch.
  if (mode === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
  } else {
    root.classList.remove("light");
    root.classList.add("dark");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return ((localStorage.getItem(STORAGE_KEY) as Theme) || "dark");
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    theme === "system" ? getSystem() : (theme as "light" | "dark")
  );

  useEffect(() => {
    const mode = theme === "system" ? getSystem() : (theme as "light" | "dark");
    setResolved(mode);
    applyClass(mode);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme stays active for this session if browser storage is unavailable.
    }
  }, [theme]);

  // Listen to system changes when in "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const mode = mq.matches ? "dark" : "light";
      setResolved(mode);
      applyClass(mode);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}
