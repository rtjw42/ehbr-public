// @vitest-environment node
// The reminder rule, and the handler's contract around it: who may call it, what
// reaches Telegram, and what reaches Healthchecks.io.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupPendingRequests, requestsToRemind, type PendingBookingRow } from "../_shared/booking-reminder";
import { BASE_ENV, loadModule, makeClient, makeRequest, stubFetch } from "./harness";

const client = vi.hoisted(() => ({ current: null as ReturnType<typeof makeClient> | null }));
vi.mock("npm:@supabase/supabase-js@2", () => ({ createClient: vi.fn(() => client.current) }));

// 2026-11-10 10:00 SGT, a scheduled run. The window is 11 Nov 10:00 to 12 Nov 10:00 SGT.
const RUN = "2026-11-10T02:00:00Z";
const IN_WINDOW = "2026-11-11T12:00:00Z"; // 11 Nov 8pm SGT
const LONG_AGO = "2026-11-01T02:00:00Z";

const row = (overrides: Partial<PendingBookingRow> = {}): PendingBookingRow => ({
  id: "b1",
  group_id: null,
  title: "Practice",
  name: "Bandit",
  start_time: IN_WINDOW,
  end_time: "2026-11-11T14:00:00Z",
  created_at: LONG_AGO,
  booking_groups: null,
  ...overrides,
});

const due = (rows: PendingBookingRow[], now = RUN) => requestsToRemind(groupPendingRequests(rows), new Date(now));

describe("groupPendingRequests", () => {
  it("counts a group once and each single once", () => {
    const rows = [row({ id: "a", group_id: "g" }), row({ id: "b", group_id: "g" }), row({ id: "c" }), row({ id: "d" })];
    expect(groupPendingRequests(rows)).toHaveLength(3);
  });

  it("takes the earliest created_at as the request time", () => {
    const rows = [
      row({ id: "a", group_id: "g", created_at: "2026-11-02T00:00:01Z" }),
      row({ id: "b", group_id: "g", created_at: "2026-11-02T00:00:00Z" }),
    ];
    expect(groupPendingRequests(rows)[0].requestedAt).toBe("2026-11-02T00:00:00Z");
  });

  it("reads weekly from the group, and treats anything else as no pattern", () => {
    const weekly = row({ group_id: "g", booking_groups: { recurrence: "weekly" } });
    expect(groupPendingRequests([weekly])[0].recurrence).toBe("weekly");
    const picked = row({ group_id: "g", booking_groups: { recurrence: null } });
    expect(groupPendingRequests([picked])[0].recurrence).toBe("none");
  });
});

describe("requestsToRemind", () => {
  it.each([
    ["exactly 24h away", "2026-11-11T02:00:00Z", 1],
    ["inside the window", IN_WINDOW, 1],
    ["just under 48h away", "2026-11-12T01:59:59Z", 1],
    ["exactly 48h away, tomorrow's run", "2026-11-12T02:00:00Z", 0],
    ["just under 24h away, yesterday's run", "2026-11-11T01:59:59Z", 0],
  ])("%s", (_label, start_time, expected) => {
    expect(due([row({ start_time })])).toHaveLength(expected);
  });

  it("needs at least 48h between the request and its first session", () => {
    expect(due([row({ created_at: "2026-11-09T12:00:00Z" })])).toHaveLength(1); // exactly 48h
    expect(due([row({ created_at: "2026-11-09T12:00:01Z" })])).toHaveLength(0);
  });

  it("goes by the first session of a group, so a later session never re-matches it", () => {
    const inWindow = row({ id: "a", group_id: "g" });
    const nextWeek = row({ id: "b", group_id: "g", start_time: "2026-11-18T12:00:00Z" });
    expect(due([inWindow, nextWeek])).toHaveLength(1);
    expect(due([inWindow, nextWeek], "2026-11-17T02:00:00Z")).toHaveLength(0);
  });

  it("matches each session on exactly one run, however late cron fires", () => {
    const sessions = ["2026-11-12T02:00:00Z", "2026-11-12T02:00:02Z", "2026-11-12T01:59:59Z"];
    const runs = ["2026-11-09T02:00:03Z", "2026-11-10T02:00:00Z", "2026-11-11T02:00:07Z", "2026-11-12T02:00:01Z"];
    for (const start_time of sessions) {
      const matches = runs.filter((now) => due([row({ start_time })], now).length === 1);
      expect(matches).toHaveLength(1);
    }
  });
});

describe("telegram-reminder handler", () => {
  const SECRET = "trigger-secret";
  const ENV = {
    ...BASE_ENV,
    TELEGRAM_TRIGGER_SECRET: SECRET,
    TELEGRAM_BOT_TOKEN: "bot",
    TELEGRAM_ADMIN_CHAT_ID: "-100",
    TELEGRAM_ADMIN_THREAD_ID: "3",
    SITE_URL: "https://site.example/",
    HEALTHCHECKS_PING_KEY: "pk",
  };
  const trigger = (secret = SECRET) =>
    makeRequest({ reminder: true }, { origin: null, headers: { "x-telegram-trigger-secret": secret } });
  const load = async (env: Record<string, string> = ENV) =>
    (await loadModule(() => import("../telegram-reminder/index.ts"), env)).handler;

  const answerWith = (result: { data?: unknown; error?: unknown }) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => result),
    };
    client.current!.from.mockReturnValue(query);
    return query;
  };

  // Answers Telegram with its own JSON shape; `failTelegram` rejects every send.
  const stubNetwork = (failTelegram = false) => {
    const fetchMock = stubFetch();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes("api.telegram.org")
        ? new Response(JSON.stringify(failTelegram ? { ok: false, description: "nope" } : { ok: true, result: { message_id: 1 } }))
        : new Response("OK"),
    );
    return fetchMock;
  };
  const callsTo = (fetchMock: ReturnType<typeof stubFetch>, host: string) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes(host));

  let quiet: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(RUN), toFake: ["Date"] });
    client.current = makeClient();
    quiet = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
  });
  afterEach(() => {
    vi.useRealTimers();
    quiet.forEach((spy) => spy.mockRestore());
    vi.unstubAllGlobals();
  });

  it("refuses anything but POST", async () => {
    stubNetwork();
    const res = await (await load())(makeRequest(undefined, { method: "GET", origin: null }));
    expect(res.status).toBe(405);
  });

  it("fails closed on a wrong secret, and on no configured secret at all", async () => {
    const fetchMock = stubNetwork();
    expect((await (await load())(trigger("wrong"))).status).toBe(403);
    expect((await (await load({ ...ENV, TELEGRAM_TRIGGER_SECRET: "" }))(trigger(""))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads only pending rows, with a limit", async () => {
    stubNetwork();
    const query = answerWith({ data: [] });
    await (await load())(trigger());
    expect(query.eq).toHaveBeenCalledWith("status", "pending");
    expect(query.limit).toHaveBeenCalledWith(2000);
  });

  it("reports healthy with nothing to send, and sends nothing", async () => {
    const fetchMock = stubNetwork();
    answerWith({ data: [] });
    const res = await (await load())(trigger());
    expect(await res.json()).toEqual({ ok: true, sent: 0, failed: 0 });
    expect(callsTo(fetchMock, "api.telegram.org")).toHaveLength(0);
    expect(callsTo(fetchMock, "hc-ping.com").map(([url]) => String(url))).toEqual([
      "https://hc-ping.com/pk/telegram-reminder?create=1",
    ]);
  });

  it("sends one notifying message per due request to the admin thread, counting the whole queue", async () => {
    const fetchMock = stubNetwork();
    answerWith({
      data: [
        row({ id: "a" }),
        row({ id: "b", title: "Jam" }),
        row({ id: "c", start_time: "2026-11-20T12:00:00Z", end_time: "2026-11-20T14:00:00Z" }), // pending, not due
      ],
    });
    const res = await (await load())(trigger());
    expect(await res.json()).toEqual({ ok: true, sent: 2, failed: 0 });

    const sends = callsTo(fetchMock, "api.telegram.org");
    expect(sends).toHaveLength(2);
    const payload = JSON.parse(String((sends[0][1] as RequestInit).body));
    expect(payload).toMatchObject({ chat_id: "-100", message_thread_id: 3, parse_mode: "HTML", disable_notification: false });
    expect(payload.text).toContain("Request still pending");
    expect(payload.text).toContain("3 pending");
    expect(payload.text).toContain('href="https://site.example/?admin=login&amp;next=/admin"');
  });

  it("carries on past a failed send and reports the failure with counts only", async () => {
    const fetchMock = stubNetwork(true);
    answerWith({ data: [row({ id: "a", name: "Private Name" }), row({ id: "b" })] });
    const res = await (await load())(trigger());
    expect(await res.json()).toEqual({ ok: false, sent: 0, failed: 2 });
    expect(callsTo(fetchMock, "api.telegram.org")).toHaveLength(2);

    const [url, init] = callsTo(fetchMock, "hc-ping.com")[0];
    expect(String(url)).toBe("https://hc-ping.com/pk/telegram-reminder/fail?create=1");
    expect((init as RequestInit).body).toBe("0 sent, 2 failed");
  });

  it("reports a failed query as a failure and sends nothing", async () => {
    const fetchMock = stubNetwork();
    answerWith({ error: { message: "boom" } });
    const res = await (await load())(trigger());
    expect(res.status).toBe(500);
    expect(callsTo(fetchMock, "api.telegram.org")).toHaveLength(0);
    expect(String(callsTo(fetchMock, "hc-ping.com")[0][0])).toContain("/telegram-reminder/fail");
  });

  it("reports a failure when the destination is not configured", async () => {
    const fetchMock = stubNetwork();
    const res = await (await load({ ...ENV, TELEGRAM_ADMIN_CHAT_ID: "" }))(trigger());
    expect(await res.json()).toEqual({ ok: false, reason: "not configured" });
    expect(String(callsTo(fetchMock, "hc-ping.com")[0][0])).toContain("/telegram-reminder/fail");
  });

  it("stays silent towards Healthchecks.io without a ping key", async () => {
    const fetchMock = stubNetwork();
    answerWith({ data: [] });
    await (await load({ ...ENV, HEALTHCHECKS_PING_KEY: "" }))(trigger());
    expect(callsTo(fetchMock, "hc-ping.com")).toHaveLength(0);
  });
});
