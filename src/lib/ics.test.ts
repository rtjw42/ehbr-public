import { describe, expect, it } from "vitest";
import { calendarFilename, createIcsCalendar } from "./ics";

const entry = {
  uid: "b1",
  title: "Practice",
  start: new Date("2026-10-21T11:00:00.000Z"),
  end: new Date("2026-10-21T13:00:00.000Z"),
};

// RFC 5545 content lines are CRLF-separated; a folded continuation starts with one space.
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const property = (ics: string, name: string) =>
  unfold(ics).split("\r\n").find((line) => line.startsWith(`${name}:`));

describe("createIcsCalendar", () => {
  it("wraps events in a calendar with CRLF line endings and UTC timestamps", () => {
    const ics = createIcsCalendar([entry]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(property(ics, "DTSTART")).toBe("DTSTART:20261021T110000Z");
    expect(property(ics, "DTEND")).toBe("DTEND:20261021T130000Z");
    expect(property(ics, "UID")).toBe("UID:b1@eusoff-bandits");
  });

  it("omits optional properties that are empty", () => {
    const ics = createIcsCalendar([{ ...entry, description: null, location: "" }]);
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
  });

  it("escapes backslash, semicolon, comma and newlines in user text", () => {
    const ics = createIcsCalendar([{ ...entry, title: "a\\b;c,d\ne" }]);
    expect(property(ics, "SUMMARY")).toBe("SUMMARY:a\\\\b\\;c\\,d\\ne");
  });

  it("never lets a carriage return in user text start a new content line", () => {
    for (const title of ["one\rLOCATION:spoof", "one\r\nLOCATION:spoof"]) {
      const lines = unfold(createIcsCalendar([{ ...entry, title }])).split("\r\n");
      expect(lines.filter((line) => line.startsWith("LOCATION:"))).toEqual([]);
      expect(lines.join("\n")).not.toContain("\r");
      expect(property(createIcsCalendar([{ ...entry, title }]), "SUMMARY")).toBe("SUMMARY:one\\nLOCATION:spoof");
    }
  });

  it("folds long lines to at most 75 octets, counting multi-byte characters by their bytes", () => {
    const encoder = new TextEncoder();
    for (const title of ["x".repeat(200), "排练".repeat(60), "🎸".repeat(50)]) {
      const ics = createIcsCalendar([{ ...entry, title }]);
      for (const line of ics.split("\r\n")) {
        expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      }
      expect(property(ics, "SUMMARY")).toBe(`SUMMARY:${title}`);
    }
  });

  it("never splits a character across folded lines", () => {
    const ics = createIcsCalendar([{ ...entry, title: "🎸".repeat(50) }]);
    for (const line of ics.split("\r\n")) {
      expect(line).not.toMatch(/[\uD800-\uDBFF]$/); // no lone high surrogate at a line end
    }
  });
});

describe("calendarFilename", () => {
  it("names the file after the date", () => {
    expect(calendarFilename(new Date(2026, 9, 21))).toBe("eusoff-bandits-2026-10-21.ics");
  });
});
