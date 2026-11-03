import { afterEach, describe, expect, it } from "vitest";
import { enUS, zhCN } from "date-fns/locale";
import {
  formatClockRange,
  formatClockTime,
  formatDateAtTime,
  formatLocalizedDate,
  getDateLocale,
  setClockPreferHour12,
} from "./date";

// Local-time constructors keep these independent of the machine's time zone.
const afternoon = new Date(2026, 9, 21, 14, 30);
const morning = new Date(2026, 9, 21, 9, 5);

// The 12h/24h preference is module state; restore the default after every test.
afterEach(() => setClockPreferHour12(false));

describe("locale", () => {
  it("uses Chinese for zh and English for anything else", () => {
    expect(getDateLocale("zh")).toBe(zhCN);
    expect(getDateLocale("en")).toBe(enUS);
    expect(getDateLocale("fr")).toBe(enUS);
  });

  it("formats a date with the pattern for its language", () => {
    expect(formatLocalizedDate(afternoon, "en", "d MMM", "M月d日")).toBe("21 Oct");
    expect(formatLocalizedDate(afternoon, "zh", "d MMM", "M月d日")).toBe("10月21日");
  });
});

describe("clock time", () => {
  it("defaults to 24h with zero-padded hours", () => {
    expect(formatClockTime(afternoon, "en")).toBe("14:30");
    expect(formatClockTime(morning, "zh")).toBe("09:05");
  });

  it("follows the 12h preference in both languages, with Latin am/pm", () => {
    setClockPreferHour12(true);
    expect(formatClockTime(afternoon, "en")).toBe("2:30pm");
    expect(formatClockTime(afternoon, "zh")).toBe("2:30pm");
  });

  it("lets an explicit hour12 option override the preference", () => {
    setClockPreferHour12(true);
    expect(formatClockTime(afternoon, "en", { hour12: false })).toBe("14:30");
    setClockPreferHour12(false);
    expect(formatClockTime(morning, "en", { hour12: true })).toBe("9:05am");
  });

  it("joins a range with an en dash", () => {
    expect(formatClockRange(morning, afternoon, "en")).toBe("09:05–14:30");
  });

  it("puts the date and the preferred clock time either side of the separator", () => {
    expect(formatDateAtTime(afternoon, "en", "d MMM", "M月d日")).toBe("21 Oct · 14:30");
    setClockPreferHour12(true);
    expect(formatDateAtTime(afternoon, "zh", "d MMM", "M月d日", " ")).toBe("10月21日 2:30pm");
  });
});
