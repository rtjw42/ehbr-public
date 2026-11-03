// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_ENV, loadModule, makeClient, stubFetch } from "./harness";

const client = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("npm:@supabase/supabase-js@2", () => ({ createClient: vi.fn(() => client.current) }));

const load = (env = BASE_ENV) => loadModule(() => import("../_shared/health.ts"), env);
const spec = { name: "submit-booking", required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RATE_LIMIT_SALT"], requiredWhenMonitored: ["TELEGRAM_BOT_TOKEN"] };

afterEach(() => vi.unstubAllGlobals());

describe("isHealthRequest", () => {
  it("needs both the warm-up secret and the deep flag", async () => {
    const { isHealthRequest } = await load();
    const req = (headers: Record<string, string>) => new Request("https://x.example", { headers });
    expect(isHealthRequest(req({ "x-warmup-secret": "warm-secret", "x-health": "deep" }))).toBe(true);
    expect(isHealthRequest(req({ "x-warmup-secret": "warm-secret" }))).toBe(false);
    expect(isHealthRequest(req({ "x-warmup-secret": "wrong", "x-health": "deep" }))).toBe(false);
  });
});

describe("runHealthCheck", () => {
  it("passes when everything is set and the database answers, pinging the function's check", async () => {
    client.current = makeClient();
    const fetchMock = stubFetch();
    const { runHealthCheck } = await load({ ...BASE_ENV, HEALTHCHECKS_PING_KEY: "pk", TELEGRAM_BOT_TOKEN: "t" });
    const res = await runHealthCheck(spec);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, problems: [] });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://hc-ping.com/pk/submit-booking?create=1");
  });

  it("names every missing secret, never a value, and pings /fail", async () => {
    client.current = makeClient();
    const fetchMock = stubFetch();
    const { runHealthCheck } = await load({ ...BASE_ENV, RATE_LIMIT_SALT: "", HEALTHCHECKS_PING_KEY: "pk" });
    const res = await runHealthCheck(spec);
    expect(res.status).toBe(503);
    expect((await res.json()).problems).toEqual(["RATE_LIMIT_SALT missing", "TELEGRAM_BOT_TOKEN missing"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://hc-ping.com/pk/submit-booking/fail?create=1");
    expect(init?.body).toBe("RATE_LIMIT_SALT missing\nTELEGRAM_BOT_TOKEN missing");
    expect(String(init?.body)).not.toContain("service-key");
  });

  it("requires monitoring-only secrets only where monitoring is configured", async () => {
    client.current = makeClient();
    const fetchMock = stubFetch();
    const { runHealthCheck } = await load(BASE_ENV); // no ping key, no Telegram
    const res = await runHealthCheck(spec);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags a missing origin allow-list", async () => {
    client.current = makeClient();
    stubFetch();
    const { runHealthCheck } = await load({ ...BASE_ENV, ALLOWED_ORIGINS: "", SITE_URL: "" });
    expect((await (await runHealthCheck(spec)).json()).problems).toContain("ALLOWED_ORIGINS and SITE_URL both missing");
  });

  it("reports a database that cannot answer", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    client.current = makeClient({ security_rate_limit_blocked: { error: { message: "paused" } } });
    stubFetch();
    const { runHealthCheck } = await load();
    expect((await (await runHealthCheck(spec)).json()).problems).toEqual(["database check failed"]);
    error.mockRestore();
  });

  it("skips the database probe when its credentials are missing", async () => {
    const current = makeClient();
    client.current = current;
    stubFetch();
    const { runHealthCheck } = await load({ ...BASE_ENV, SUPABASE_SERVICE_ROLE_KEY: "" });
    expect((await (await runHealthCheck(spec)).json()).problems).toEqual(["SUPABASE_SERVICE_ROLE_KEY missing"]);
    expect(current.rpc).not.toHaveBeenCalled();
  });

  it("still answers when Healthchecks.io is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    client.current = makeClient();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { runHealthCheck } = await load({ ...BASE_ENV, HEALTHCHECKS_PING_KEY: "pk", TELEGRAM_BOT_TOKEN: "t" });
    expect((await runHealthCheck(spec)).status).toBe(200);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
