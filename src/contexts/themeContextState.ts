import { createContext } from "react";

export type Theme = "light" | "dark" | "system";

export type ThemeCtx = {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
};

export const ThemeContext = createContext<ThemeCtx | null>(null);
