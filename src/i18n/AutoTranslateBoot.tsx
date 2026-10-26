import { useEffect } from "react";
import i18n from "i18next";

type AutoTranslateRuntime = typeof import("./autoTranslate");

// The large fallback dictionary is only needed for English UI text that has
// not yet been moved to translation keys. Do not put it on the Arabic startup path.
export default function AutoTranslateBoot() {
  useEffect(() => {
    let mounted = true;
    let runtime: AutoTranslateRuntime | null = null;
    let pending: Promise<AutoTranslateRuntime> | null = null;

    const applyLanguage = (language: string) => {
      if (!language.startsWith("en")) {
        runtime?.stopAutoTranslate(true);
        return;
      }
      if (runtime) {
        runtime.startAutoTranslate();
        return;
      }
      pending ??= import("./autoTranslate");
      void pending.then((module) => {
        if (!mounted) return;
        runtime = module;
        if (i18n.language.startsWith("en")) module.startAutoTranslate();
      }).catch((error: unknown) => {
        pending = null;
        // A failed language chunk should remain visible in diagnostics rather
        // than silently pretending that the English UI is complete.
        console.error("Failed to load English UI translations", error);
      });
    };

    applyLanguage(i18n.language);
    i18n.on("languageChanged", applyLanguage);
    return () => {
      mounted = false;
      i18n.off("languageChanged", applyLanguage);
      runtime?.stopAutoTranslate(true);
    };
  }, []);

  return null;
}
