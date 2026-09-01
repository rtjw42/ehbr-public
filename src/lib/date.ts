import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";

export function getDateLocale(language: string) {
  return language === "zh" ? zhCN : enUS;
}

export function formatLocalizedDate(date: Date, language: string, englishPattern: string, chinesePattern: string) {
  return format(date, language === "zh" ? chinesePattern : englishPattern, {
    locale: getDateLocale(language),
  });
}

// ── Clock time ────────────────────────────────────────────────────────────────
// Single authority for rendering a time of day. The user's 12h/24h choice is a
// UI-only preference (PLANS.md #5): it is mirrored here into `preferHour12` so
// every caller flips at once, with no per-call-site plumbing. This is display
// only — stored times (Supabase) and the Telegram edge functions are untouched;
// those have their own formatters and never import this module. An explicit
// `hour12` option still wins where a caller must pin a format regardless.
let preferHour12 = false;

// Called by the preferences provider whenever the setting loads or changes.
// Mutated synchronously before React re-renders so the first paint is correct.
export function setClockPreferHour12(value: boolean) {
  preferHour12 = value;
}

export function formatClockTime(date: Date, language: string, options: { hour12?: boolean } = {}) {
  const hour12 = options.hour12 ?? preferHour12;
  // 12h uses Latin am/pm in both languages (e.g. "2:30pm") — deliberately not the
  // localized 上午/下午, which would also flip word order in Chinese. 24h stays
  // locale-formatted digits.
  if (hour12) return format(date, "h:mmaaa", { locale: enUS });
  return format(date, "HH:mm", { locale: getDateLocale(language) });
}

export function formatClockRange(start: Date, end: Date, language: string, options: { hour12?: boolean } = {}) {
  return `${formatClockTime(start, language, options)}–${formatClockTime(end, language, options)}`;
}

// Localized "date <sep> time" where the clock portion follows the 12h/24h
// preference. Keeps the date pattern and time formatting as separate concerns so
// the time flips without duplicating locale date patterns at every call site.
export function formatDateAtTime(
  date: Date,
  language: string,
  englishDatePattern: string,
  chineseDatePattern: string,
  separator = " · ",
) {
  return `${formatLocalizedDate(date, language, englishDatePattern, chineseDatePattern)}${separator}${formatClockTime(date, language)}`;
}
