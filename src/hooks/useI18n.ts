import { useCallback } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { translate, type TranslationKey } from "@/lib/i18n";

export const useI18n = () => {
  const { language } = usePreferences();

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );

  return { language, t };
};
