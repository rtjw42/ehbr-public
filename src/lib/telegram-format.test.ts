// Tables for the pure Telegram message builders shared with the Edge Functions.
// The source lives in supabase/functions/_shared so Deno and Vitest import the
// exact same file. All inputs are UTC ISO strings; output must be Asia/Singapore
// (UTC+8) regardless of the machine's local timezone.
import { describe, expect, it } from "vitest";
import {
  buildAdminRequestMessage,
  buildWeeklyBoardMessage,
  formatTelegramTimeRange,
  isMultiDaySgt,
  sgtBoardWeekWindow,
  sgtWeekWindow,
} from "../../supabase/functions/_shared/telegram-format.ts";

const RULE = "─".repeat("New booking request".length); // admin-ping top divider, sized to the header
const BOOKING_URL = "https://band.test/bookings";
// 2026-06-15 is a Monday; SGT = UTC+8, so 11:00Z = 7pm SGT.
const iso = (utc: string) => new Date(utc).toISOString();

describe("formatTelegramTimeRange", () => {
  it.each([
    // Same meridian → the start drops its am/pm (compact).
    ["2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z", "7–9pm"],
    ["2026-06-15T06:30:00Z", "2026-06-15T08:00:00Z", "2:30–4pm"],
    ["2026-06-15T11:24:00Z", "2026-06-15T12:43:00Z", "7:24–8:43pm"],
    ["2026-06-14T16:00:00Z", "2026-06-14T18:00:00Z", "12–2am"],
    ["2026-06-15T04:00:00Z", "2026-06-15T05:15:00Z", "12–1:15pm"],
    // Different meridian → both keep their suffix.
    ["2026-06-15T03:00:00Z", "2026-06-15T05:00:00Z", "11am–1pm"],
  ])("renders %s → %s as %s", (start, end, expected) => {
    expect(formatTelegramTimeRange(iso(start), iso(end))).toBe(expected);
  });
});

describe("isMultiDaySgt", () => {
  it.each([
    // Same SGT day → not multi-day.
    ["2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z", false],
    // Ends exactly at SGT midnight → still the same (occupied) day, not multi-day.
    ["2026-06-15T04:00:00Z", "2026-06-15T16:00:00Z", false],
    // Crosses into the next SGT day.
    ["2026-07-05T19:00:00Z", "2026-07-07T21:00:00Z", true],
  ])("%s → %s multi-day=%s", (start, end, expected) => {
    expect(isMultiDaySgt(iso(start), iso(end))).toBe(expected);
  });
});

describe("buildAdminRequestMessage", () => {
  const row = (startUtc: string, endUtc: string) => ({
    start_time: iso(startUtc),
    end_time: iso(endUtc),
  });

  it("renders a single-date request as a bold title + who·date·time, no count", () => {
    const text = buildAdminRequestMessage({
      title: "Jam session",
      name: "Ryan",
      info: "",
      recurrence: "none",
      rows: [row("2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z")],
      reviewUrl: "https://example.test/?admin=login&next=/admin",
    });
    expect(text).toBe(
      [
        RULE,
        "🖊️ <b>New booking request</b>",
        "",
        "<b>Jam session</b>",
        "Ryan · <b>15 Jun</b> · <b>7–9pm</b>",
        "",
        '<a href="https://example.test/?admin=login&amp;next=/admin">Approve / Reject</a>',
      ].join("\n"),
    );
  });

  it("renders a weekly request as 'Every <day> · <time>' + a run line, never a full list", () => {
    // Weekly every Wed, four weeks: 17 Jun, 24 Jun, 1 Jul, 8 Jul (SGT).
    const text = buildAdminRequestMessage({
      title: "Band prac",
      name: "Ryan",
      info: "",
      recurrence: "weekly",
      rows: [
        row("2026-06-17T11:00:00Z", "2026-06-17T13:00:00Z"),
        row("2026-06-24T11:00:00Z", "2026-06-24T13:00:00Z"),
        row("2026-07-01T11:00:00Z", "2026-07-01T13:00:00Z"),
        row("2026-07-08T11:00:00Z", "2026-07-08T13:00:00Z"),
      ],
      reviewUrl: "u",
    });
    expect(text).toContain("Ryan · <b>Every Wednesday</b> · <b>7–9pm</b>");
    expect(text).toContain("17 Jun – 8 Jul · 4 sessions");
    expect(text).not.toContain("24 Jun");
  });

  it("renders a multi-day single booking as one span, no separate date/time", () => {
    // 2026-07-05T19:00Z → 6 Jul 3am SGT; 2026-07-07T21:00Z → 8 Jul 5am SGT.
    const text = buildAdminRequestMessage({
      title: "Band camp",
      name: "Ryan",
      info: "",
      recurrence: "none",
      rows: [row("2026-07-05T19:00:00Z", "2026-07-07T21:00:00Z")],
      reviewUrl: "u",
    });
    expect(text).toContain("Ryan · <b>6 Jul 3am → 8 Jul 5am</b>");
  });

  it("lists pick-dates (arbitrary days) chronologically, with a blockquoted note", () => {
    const text = buildAdminRequestMessage({
      title: "Jam session",
      name: "Ryan",
      info: "Need the room for full-band rehearsal",
      recurrence: "none",
      rows: [
        row("2026-06-19T11:00:00Z", "2026-06-19T13:00:00Z"),
        row("2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z"),
        row("2026-06-17T11:00:00Z", "2026-06-17T13:00:00Z"),
      ],
      reviewUrl: "u",
    });
    expect(text).toContain("Ryan · <b>7–9pm</b>");
    expect(text).toContain("15, 17, 19 Jun · 3 dates");
    expect(text).toContain("<i>Need the room for full-band rehearsal</i>");
  });

  it("appends the pending count to the action line", () => {
    const base = {
      title: "Jam",
      name: "Ryan",
      info: "",
      recurrence: "none" as const,
      rows: [row("2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z")],
      reviewUrl: "u",
    };
    expect(buildAdminRequestMessage({ ...base, pendingCount: 3 })).toContain(
      '<a href="u">Approve / Reject</a> · 3 pending',
    );
    expect(buildAdminRequestMessage(base)).not.toContain("pending");
    // Zero is a real count, not "missing" — it must still render.
    expect(buildAdminRequestMessage({ ...base, pendingCount: 0 })).toContain("· 0 pending");
  });

  it("escapes HTML-significant characters in user fields", () => {
    const text = buildAdminRequestMessage({
      title: "Rock & <b>Roll</b>",
      name: "A > B",
      info: "",
      recurrence: "none",
      rows: [row("2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z")],
      reviewUrl: "u",
    });
    expect(text).toContain("<b>Rock &amp; &lt;b&gt;Roll&lt;/b&gt;</b>");
    expect(text).toContain("A &gt; B · <b>15 Jun</b>");
  });

  it("escapes HTML in the note (info) field, which sits inside <i>…</i>", () => {
    const text = buildAdminRequestMessage({
      title: "Jam",
      name: "Ryan",
      info: "</i><b>hi</b> & <script>",
      recurrence: "none",
      rows: [row("2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z")],
      reviewUrl: "u",
    });
    // Without escaping, the </i> would close the italic and <b>/<script> would be
    // live markup — assert every angle bracket and ampersand is inert.
    expect(text).toContain("<i>&lt;/i&gt;&lt;b&gt;hi&lt;/b&gt; &amp; &lt;script&gt;</i>");
  });

  it("escapes quotes/apostrophes and neutralizes href attribute breakout", () => {
    const text = buildAdminRequestMessage({
      title: `He said "go" it's on`,
      name: "Ryan",
      info: "",
      recurrence: "none",
      rows: [row("2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z")],
      reviewUrl: `https://x.test/?a="><b>`,
    });
    expect(text).toContain("&quot;go&quot;");
    expect(text).toContain("it&#39;s");
    // The URL's " and angle brackets are escaped, so the surrounding href="…"
    // attribute can't be closed early and no tag can be injected after it.
    expect(text).toContain(`href="https://x.test/?a=&quot;&gt;&lt;b&gt;"`);
  });

  it("omits an empty note and truncates a long one to ~140 chars", () => {
    const base = {
      title: "Jam",
      name: "Ryan",
      recurrence: "none" as const,
      rows: [row("2026-06-15T11:00:00Z", "2026-06-15T13:00:00Z")],
      reviewUrl: "u",
    };
    expect(buildAdminRequestMessage({ ...base, info: "   " })).not.toContain("<i>");

    const long = "x".repeat(200);
    const text = buildAdminRequestMessage({ ...base, info: long });
    expect(text).toContain(`<i>${"x".repeat(140)}…</i>`);
  });

  it("assigns a date to its SGT calendar day, not the UTC one", () => {
    // 2026-06-14T16:30:00Z is already Mon 15 Jun, 00:30 in Singapore.
    const text = buildAdminRequestMessage({
      title: "Jam",
      name: "Ryan",
      info: "",
      recurrence: "none",
      rows: [row("2026-06-14T16:30:00Z", "2026-06-14T18:00:00Z")],
      reviewUrl: "u",
    });
    expect(text).toContain("Ryan · <b>15 Jun</b> · <b>12:30–2am</b>");
  });
});

describe("sgtWeekWindow", () => {
  it("spans Mon 00:00 SGT to the next Mon 00:00 SGT", () => {
    // Thu 18 Jun 2026, 8pm SGT → week of Mon 15 Jun.
    const { start, end } = sgtWeekWindow(new Date("2026-06-18T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-06-14T16:00:00.000Z"); // Mon 15 Jun 00:00 SGT
    expect(end.toISOString()).toBe("2026-06-21T16:00:00.000Z"); // Mon 22 Jun 00:00 SGT
  });

  it("rolls over exactly at the SGT week boundary", () => {
    // Sun 21 Jun 23:59 SGT is still the old week; Mon 22 Jun 00:05 SGT is the new one.
    expect(sgtWeekWindow(new Date("2026-06-21T15:59:00Z")).start.toISOString()).toBe(
      "2026-06-14T16:00:00.000Z",
    );
    expect(sgtWeekWindow(new Date("2026-06-21T16:05:00Z")).start.toISOString()).toBe(
      "2026-06-21T16:00:00.000Z",
    );
  });
});

describe("sgtBoardWeekWindow", () => {
  it("previews next week from Sunday 19:00 SGT (5h lead)", () => {
    // Sun 21 Jun 18:59 SGT still shows the current week (Mon 15 Jun).
    expect(sgtBoardWeekWindow(new Date("2026-06-21T10:59:00Z")).start.toISOString()).toBe(
      "2026-06-14T16:00:00.000Z",
    );
    // Sun 21 Jun 19:00 SGT rolls forward to next week (Mon 22 Jun).
    expect(sgtBoardWeekWindow(new Date("2026-06-21T11:00:00Z")).start.toISOString()).toBe(
      "2026-06-21T16:00:00.000Z",
    );
  });
});

describe("buildWeeklyBoardMessage", () => {
  const now = new Date("2026-06-18T12:00:00Z"); // Thu 18 Jun, 8pm SGT

  it("renders the branded board: title, rule, bold day blocks, link, stamp", () => {
    const text = buildWeeklyBoardMessage({
      now,
      bookingUrl: BOOKING_URL,
      rows: [
        {
          start_time: iso("2026-06-16T06:30:00Z"),
          end_time: iso("2026-06-16T08:00:00Z"),
          title: "Vocal practice",
          name: "Mei",
        },
        {
          start_time: iso("2026-06-15T11:00:00Z"),
          end_time: iso("2026-06-15T13:00:00Z"),
          title: "Jam session",
          name: "Ryan",
        },
        {
          start_time: iso("2026-06-15T13:00:00Z"),
          end_time: iso("2026-06-15T14:00:00Z"),
          title: "Solo run",
          name: "Ken",
        },
      ],
    });
    expect(text).toBe(
      [
        "🎸 <b>Band room — 15–21 Jun</b> 🥁",
        "",
        "<b>Mon 15 Jun</b>",
        "   <b>7–9pm</b> · Jam session · Ryan",
        "   <b>9–10pm</b> · Solo run · Ken",
        "",
        "<b>Tue 16 Jun</b>",
        "   <b>2:30–4pm</b> · Vocal practice · Mei",
        "",
        `<a href="${BOOKING_URL}">📅 Open the booking calendar</a>`,
        "",
        "<i>Updated Thu, 18 Jun, 8pm</i>",
      ].join("\n"),
    );
  });

  it("renders the honest empty state", () => {
    const text = buildWeeklyBoardMessage({ now, bookingUrl: BOOKING_URL, rows: [] });
    expect(text).toBe(
      [
        "🎸 <b>Band room — 15–21 Jun</b> 🥁",
        "",
        "No bookings this week.",
        "",
        `<a href="${BOOKING_URL}">📅 Open the booking calendar</a>`,
        "",
        "<i>Updated Thu, 18 Jun, 8pm</i>",
      ].join("\n"),
    );
  });

  it("spells out both months when the week crosses a month boundary", () => {
    // Tue 30 Jun 2026 → week Mon 29 Jun – Sun 5 Jul.
    const text = buildWeeklyBoardMessage({
      now: new Date("2026-06-30T04:00:00Z"),
      bookingUrl: BOOKING_URL,
      rows: [],
    });
    expect(text).toContain("29 Jun–5 Jul");
  });

  it("escapes user fields in the board (HTML mode)", () => {
    const text = buildWeeklyBoardMessage({
      now,
      bookingUrl: BOOKING_URL,
      rows: [
        {
          start_time: iso("2026-06-15T11:00:00Z"),
          end_time: iso("2026-06-15T13:00:00Z"),
          title: "R&D <jam>",
          name: "A & B",
        },
      ],
    });
    expect(text).toContain("· R&amp;D &lt;jam&gt; · A &amp; B");
  });

  it("splits a multi-day booking per day: first slice, Whole day, then a (cont.) suffix", () => {
    // Mon 15 Jun 10pm SGT → Wed 17 Jun 2am SGT: Mon 10pm–12am, Tue whole day, Wed 12–2am.
    const text = buildWeeklyBoardMessage({
      now,
      bookingUrl: BOOKING_URL,
      rows: [
        {
          start_time: iso("2026-06-15T14:00:00Z"),
          end_time: iso("2026-06-16T18:00:00Z"),
          title: "Overnight",
          name: "Ryan",
        },
      ],
    });
    // First day: real slice, no marker. Full middle day: "Whole day". Both
    // continued days carry the "(cont.)" suffix after the name.
    expect(text).toContain("<b>Mon 15 Jun</b>\n   <b>10pm–12am</b> · Overnight · Ryan");
    expect(text).toContain("<b>Tue 16 Jun</b>\n   <b>Whole day</b> · Overnight · Ryan (cont.)");
    expect(text).toContain("<b>Wed 17 Jun</b>\n   <b>12–2am</b> · Overnight · Ryan (cont.)");
  });

  it("handles a simple past-midnight booking as two day slices with (cont.)", () => {
    // Mon 15 Jun 10pm SGT → Tue 16 Jun 2am SGT.
    const text = buildWeeklyBoardMessage({
      now,
      bookingUrl: BOOKING_URL,
      rows: [
        {
          start_time: iso("2026-06-15T14:00:00Z"),
          end_time: iso("2026-06-15T18:00:00Z"),
          title: "Late jam",
          name: "Ken",
        },
      ],
    });
    expect(text).toContain("<b>Mon 15 Jun</b>\n   <b>10pm–12am</b> · Late jam · Ken");
    expect(text).toContain("<b>Tue 16 Jun</b>\n   <b>12–2am</b> · Late jam · Ken (cont.)");
  });
});
