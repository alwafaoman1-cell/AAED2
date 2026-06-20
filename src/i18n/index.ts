// =====================================================================
// i18n setup — Arabic (default) + English with auto language detection,
// localStorage persistence, and RTL/LTR direction switching.
// =====================================================================
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ar from "./locales/ar.json";
import en from "./locales/en.json";

export type AppLang = "ar" | "en";

export const SUPPORTED_LANGS: { code: AppLang; label: string; nativeLabel: string; dir: "rtl" | "ltr" }[] = [
  { code: "ar", label: "Arabic",  nativeLabel: "العربية", dir: "rtl" },
  { code: "en", label: "English", nativeLabel: "English", dir: "ltr" },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ar: { translation: ar },
      en: { translation: en },
    },
    fallbackLng: "ar",
    supportedLngs: ["ar", "en"],
    interpolation: { escapeValue: false }, // React handles escaping
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "alwafa.lang",
      caches: ["localStorage"],
    },
    returnNull: false,
  });

/** Apply <html lang/dir> based on the active language */
export function applyDocumentDirection(lng: string) {
  const meta = SUPPORTED_LANGS.find((l) => l.code === lng) ?? SUPPORTED_LANGS[0];
  if (typeof document !== "undefined") {
    document.documentElement.lang = meta.code;
    document.documentElement.dir  = meta.dir;
  }
}

// Apply once on init and again on every change.
applyDocumentDirection(i18n.language);
i18n.on("languageChanged", applyDocumentDirection);

/** Helper used by PDF templates that run outside React */
export function getActiveLang(): AppLang {
  const l = (i18n.language || "ar").slice(0, 2);
  return (l === "en" ? "en" : "ar") as AppLang;
}

export default i18n;
