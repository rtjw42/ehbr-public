import { createContext } from "react";

export type ThemePreference = "light" | "dark";
export type LanguagePreference = "en" | "zh";
export type TimeFormatPreference = "24h" | "12h";

export type PreferencesContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  language: LanguagePreference;
  setLanguage: (language: LanguagePreference) => void;
  timeFormat: TimeFormatPreference;
  setTimeFormat: (timeFormat: TimeFormatPreference) => void;
};

export const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);
