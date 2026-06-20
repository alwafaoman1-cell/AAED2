import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

type ThemeCtx = {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
};

const STORAGE_KEY = "alwafa_theme_v1";
const Ctx = createContext<ThemeCtx | null>(null);

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
    } catch {}
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
    <Ctx.Provider value={{ theme, resolved, setTheme: setThemeState }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}
