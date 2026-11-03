// ── Preferences provider ─────────────────────────────────────────────────────
// Theme, language, and time format. Each is persisted to localStorage and
// mirrored onto <html> (the `dark` class and the `lang` attribute) so CSS and
// screen readers stay in sync. A `storage` listener keeps preferences consistent
// across open tabs.
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  PreferencesContext,
  type LanguagePreference,
  type PreferencesContextValue,
  type ThemePreference,
  type TimeFormatPreference,
} from "@/contexts/preferences-context";
import { resolveMotionTier } from "@/hooks/useMotionTier";
import { setClockPreferHour12 } from "@/lib/date";

const DARK_MODE_KEY = "dark-mode";
const LANGUAGE_KEY = "eb:language";
const TIME_FORMAT_KEY = "eb:time-format";

const readTheme = (): ThemePreference => {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(DARK_MODE_KEY) === "1" ? "dark" : "light";
};

const readLanguage = (): LanguagePreference => {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(LANGUAGE_KEY) === "zh" ? "zh" : "en";
};

const readTimeFormat = (): TimeFormatPreference => {
  if (typeof window === "undefined") return "24h";
  return window.localStorage.getItem(TIME_FORMAT_KEY) === "12h" ? "12h" : "24h";
};

// Mirror the persisted choice into the clock authority at module load so the very
// first render (before any effect runs) already formats times correctly.
setClockPreferHour12(readTimeFormat() === "12h");

export const PreferencesProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<ThemePreference>(() => readTheme());
  const [language, setLanguage] = useState<LanguagePreference>(() => readLanguage());
  const [timeFormat, setTimeFormat] = useState<TimeFormatPreference>(() => readTimeFormat());

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(DARK_MODE_KEY, theme === "dark" ? "1" : "0");
    // No theme-color meta sync: Safari keeps its native translucent glass
    // toolbars instead of a solid tinted bar. `color-scheme` (tokens.css) is
    // what tells the browser to tint that glass dark in dark mode.
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
  }, [language]);

  // Persist + mirror the clock preference into lib/date. useLayoutEffect so the
  // mirror is in place before paint on any path (e.g. cross-tab storage sync).
  // Display only — never touches stored times or the Telegram edge functions.
  useLayoutEffect(() => {
    window.localStorage.setItem(TIME_FORMAT_KEY, timeFormat);
    setClockPreferHour12(timeFormat === "12h");
  }, [timeFormat]);

  // data-motion is written pre-paint by public/theme-init.js; assert it here so
  // the attribute is still present when that script is skipped (tests/SSR).
  // Resolved once, never overriding the pre-paint value.
  useEffect(() => {
    const root = document.documentElement;
    if (!root.dataset.motion) root.dataset.motion = resolveMotionTier();
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === DARK_MODE_KEY) setTheme(readTheme());
      if (event.key === LANGUAGE_KEY) setLanguage(readLanguage());
      if (event.key === TIME_FORMAT_KEY) setTimeFormat(readTimeFormat());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setStoredTheme = useCallback((nextTheme: ThemePreference) => setTheme(nextTheme), []);
  const setStoredLanguage = useCallback((nextLanguage: LanguagePreference) => {
    if (nextLanguage === language) return;
    setLanguage(nextLanguage);
  }, [language]);
  const setStoredTimeFormat = useCallback((nextTimeFormat: TimeFormatPreference) => {
    // Mirror synchronously so the re-render this triggers paints with the new
    // format immediately, ahead of the (also-synced) layout effect.
    setClockPreferHour12(nextTimeFormat === "12h");
    setTimeFormat(nextTimeFormat);
  }, []);

  const value = useMemo<PreferencesContextValue>(() => ({
    theme,
    setTheme: setStoredTheme,
    language,
    setLanguage: setStoredLanguage,
    timeFormat,
    setTimeFormat: setStoredTimeFormat,
  }), [
    theme,
    setStoredTheme,
    language,
    setStoredLanguage,
    timeFormat,
    setStoredTimeFormat,
  ]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};
