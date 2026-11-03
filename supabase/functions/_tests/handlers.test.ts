// @vitest-environment node
// Request → response contract for the four public Edge Functions: the guards every
// public endpoint must keep (CLAUDE.md → Public surface) plus each one's own rules.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_ENV, ORIGIN, healthRequest, loadModule, makeClient, makeRequest, stubFetch, warmupRequest } from "./harness";

const client = vi.hoisted(() => ({ current: null as ReturnType<typeof makeClient> | null }));
vi.mock("npm:@supabase/supabase-js@2", () => ({ createClient: vi.fn(() => client.current) }));

type Handler = (req: Request) => Promise<Response>;
const loaders: Record<string, () => Promise<{ handler: Handler }>> = {
  "submit-booking": () => import("../submit-booking/index.ts"),
  "register-admin": () => import("../register-admin/index.ts"),
  "request-password-reset": () => import("../request-password-reset/index.ts"),
  "log-funnel-step": () => import("../log-funnel-step/index.ts"),
};
const load = async (name: string, env = BASE_ENV) => (await loadModule(loaders[name], env)).handler;

const validBodies: Record<string, unknown> = {
  "submit-booking": {
    turnstileToken: "token",
    booking: {
      title: "Practice",
      name: "Bandit",
      info: "",
      recurrence: "none",
      bookings: [{ start_time: "2026-11-02T11:00:00Z", end_time: "2026-11-02T13:00:00Z" }],
    },
  },
  "register-admin": { email: "a@b.co", password: "secret123", inviteCode: "CODE", turnstileToken: "token" },
  "request-password-reset": { email: "a@b.co", turnstileToken: "token" },
  "log-funnel-step": { step: "form_open" },
};
const sizeLimits: Record<string, number> = {
  "submit-booking": 128 * 1024,
  "register-admin": 16 * 1024,
  "request-password-reset": 16 * 1024,
  "log-funnel-step": 256,
};

let quiet: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  client.current = makeClient({
    submit_booking_request: { data: { request_id: "r1" } },
    security_is_valid_admin_invite: { data: true },
  });
  client.current.auth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
  client.current.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  stubFetch();
  quiet = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  quiet.forEach((spy) => spy.mockRestore());
  vi.unstubAllGlobals();
});

describe.each(Object.keys(loaders))("%s: guards every public endpoint keeps", (name) => {
  it("answers the deep health check before any other work", async () => {
    const res = await (await load(name))(healthRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, problems: [] });
  });

  it("rejects an origin outside the allow-list", async () => {
    const res = await (await load(name))(makeRequest(validBodies[name], { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("answers an allowed preflight", async () => {
    const res = await (await load(name))(makeRequest(undefined, { method: "OPTIONS" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("allows only POST", async () => {
    expect((await (await load(name))(makeRequest(undefined, { method: "GET" }))).status).toBe(405);
  });

  it("rejects an oversized body before reading it", async () => {
    const big = { pad: "x".repeat(sizeLimits[name]) };
    expect((await (await load(name))(makeRequest(big))).status).toBe(413);
  });

  it("rejects malformed JSON", async () => {
    expect((await (await load(name))(makeRequest(undefined, { rawBody: "{nope" }))).status).toBe(400);
  });

  it("fails with a generic 500, leaking nothing, when its Supabase environment is missing", async () => {
    const res = await (await load(name, { ...BASE_ENV, SUPABASE_SERVICE_ROLE_KEY: "" }))(makeRequest(validBodies[name]));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/SUPABASE|service|environment/i);
  });

  it("accepts a valid request", async () => {
    const res = await (await load(name))(makeRequest(validBodies[name]));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("submit-booking", () => {
  it("answers the warm-up ping without touching the database", async () => {
    const res = await (await load("submit-booking"))(warmupRequest());
    expect(await res.json()).toEqual({ ok: true, warm: true });
    expect(client.current?.rpc).not.toHaveBeenCalled();
  });

  it("passes only allow-listed fields to the database, so a client cannot set status", async () => {
    const body = validBodies["submit-booking"] as { booking: Record<string, unknown> };
    await (await load("submit-booking"))(makeRequest({ ...body, booking: { ...body.booking, status: "approved", id: "x" } }));
    const payload = client.current?.rpc.mock.calls.find(([fn]) => fn === "submit_booking_request")?.[1] as { payload: Record<string, unknown> };
    expect(payload.payload).not.toHaveProperty("status");
    expect(payload.payload).not.toHaveProperty("id");
    expect(payload.payload.title).toBe("Practice");
  });

  it("requires a Turnstile token and rejects a failed one with a retry message", async () => {
    const handler = await load("submit-booking");
    const body = validBodies["submit-booking"] as Record<string, unknown>;
    expect((await handler(makeRequest({ ...body, turnstileToken: "" }))).status).toBe(400);
    stubFetch({ turnstileSuccess: false });
    const res = await handler(makeRequest(body));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/complete the challenge/);
  });

  it("is rate limited per IP before Turnstile or any write", async () => {
    client.current = makeClient({ security_rate_limit_blocked: { data: true } });
    const res = await (await load("submit-booking"))(makeRequest(validBodies["submit-booking"]));
    expect(res.status).toBe(429);
    expect(client.current.rpc).not.toHaveBeenCalledWith("submit_booking_request", expect.anything());
  });

  it("refuses links in user text, which Telegram would turn into live links", async () => {
    const body = validBodies["submit-booking"] as { booking: Record<string, unknown> };
    const res = await (await load("submit-booking"))(makeRequest({ ...body, booking: { ...body.booking, title: "see t.me/spam" } }));
    expect(res.status).toBe(400);
  });

  it("hides database internals behind a generic error", async () => {
    client.current = makeClient({ submit_booking_request: { error: { code: "XX000", message: "relation secret_table" } } });
    const res = await (await load("submit-booking"))(makeRequest(validBodies["submit-booking"]));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
  });

  it("still confirms a saved booking when the Telegram ping fails", async () => {
    const chain = { select: () => chain, eq: () => chain, limit: async () => ({ data: [], error: null }) };
    client.current!.from.mockReturnValue(chain);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("telegram")) throw new Error("telegram down");
      return new Response(JSON.stringify({ success: true }));
    }));
    const handler = await load("submit-booking", { ...BASE_ENV, TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_ADMIN_CHAT_ID: "-100" });
    expect((await handler(makeRequest(validBodies["submit-booking"]))).status).toBe(200);
  });
});

describe("register-admin", () => {
  const body = validBodies["register-admin"] as Record<string, unknown>;

  it("locks out an IP after repeated bad invite codes", async () => {
    client.current = makeClient({ security_rate_limit_blocked: { data: true } });
    expect((await (await load("register-admin"))(makeRequest(body))).status).toBe(429);
  });

  it("rejects a missing or invalid invite code and counts the attempt", async () => {
    const handler = await load("register-admin");
    expect((await handler(makeRequest({ ...body, inviteCode: "" }))).status).toBe(400);
    client.current = makeClient({ security_is_valid_admin_invite: { data: false } });
    const res = await (await load("register-admin"))(makeRequest(body));
    expect(res.status).toBe(400);
    expect(client.current.rpc).toHaveBeenCalledWith("security_rate_limit_hit", expect.objectContaining({ _scope: "admin-invite-failed" }));
  });

  it("validates an invite on its own without creating an account", async () => {
    const res = await (await load("register-admin"))(makeRequest({ inviteCode: "CODE", action: "validate-invite" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(client.current?.auth.signUp).not.toHaveBeenCalled();
  });

  it("enforces the email format and password policy", async () => {
    const handler = await load("register-admin");
    expect((await handler(makeRequest({ ...body, email: "nope" }))).status).toBe(400);
    expect((await handler(makeRequest({ ...body, password: "short1" }))).status).toBe(400);
    expect((await handler(makeRequest({ ...body, password: "lettersonly" }))).status).toBe(400);
    expect((await handler(makeRequest({ ...body, turnstileToken: "" }))).status).toBe(400);
  });

  it("never redirects the confirmation email off the site", async () => {
    await (await load("register-admin"))(makeRequest({ ...body, emailRedirectTo: "https://evil.example/x" }));
    const options = client.current?.auth.signUp.mock.calls[0][0].options;
    expect(options.emailRedirectTo).toBe(`${ORIGIN}/registration-success`);
  });

  it("answers a duplicate signup exactly like a new one, so emails can't be enumerated", async () => {
    client.current!.auth.signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    const res = await (await load("register-admin"))(makeRequest(body));
    expect(await res.json()).toEqual({ ok: true, needsEmailConfirmation: true });
  });

  it("asks for the challenge again when Turnstile fails, leaking nothing", async () => {
    stubFetch({ turnstileSuccess: false });
    const res = await (await load("register-admin"))(makeRequest(body));
    expect(res.status).toBe(403);
    const { error } = await res.json();
    expect(error).toMatch(/complete the challenge again/);
    expect(error).not.toMatch(/turnstile|secret|stack|email/i);
    expect(client.current?.auth.signUp).not.toHaveBeenCalled();
  });

  it("keeps an unexpected failure generic", async () => {
    client.current!.auth.signUp.mockRejectedValue(new Error("db: relation auth.users"));
    const res = await (await load("register-admin"))(makeRequest(body));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Could not create account.");
  });
});

describe("request-password-reset", () => {
  const body = validBodies["request-password-reset"] as Record<string, unknown>;

  it("checks the email and token before spending a rate-limit hit", async () => {
    const handler = await load("request-password-reset");
    expect((await handler(makeRequest({ ...body, email: "nope" }))).status).toBe(400);
    expect((await handler(makeRequest({ ...body, turnstileToken: "" }))).status).toBe(400);
    expect(client.current?.rpc).not.toHaveBeenCalled();
  });

  it("is rate limited per IP", async () => {
    client.current = makeClient({ security_rate_limit_hit: { data: false } });
    expect((await (await load("request-password-reset"))(makeRequest(body))).status).toBe(429);
  });

  it("never sends the reset link off the site", async () => {
    await (await load("request-password-reset"))(makeRequest({ ...body, redirectTo: "https://evil.example" }));
    expect(client.current?.auth.resetPasswordForEmail).toHaveBeenCalledWith("a@b.co", { redirectTo: `${ORIGIN}/reset-password` });
  });

  it("asks for the challenge again when Turnstile fails", async () => {
    stubFetch({ turnstileSuccess: false });
    const res = await (await load("request-password-reset"))(makeRequest(body));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/complete the challenge again/);
    expect(client.current?.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("returns a generic error when the email service fails", async () => {
    client.current!.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "smtp: auth failed for user x" } });
    const res = await (await load("request-password-reset"))(makeRequest(body));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("smtp");
  });
});

describe("log-funnel-step", () => {
  it("records only a known step", async () => {
    const handler = await load("log-funnel-step");
    await handler(makeRequest({ step: "review" }));
    expect(client.current?.rpc).toHaveBeenCalledWith("record_funnel_step", { _step: "review" });
    expect((await handler(makeRequest({ step: "__probe__" }))).status).toBe(400);
    expect((await handler(makeRequest({ step: 7 }))).status).toBe(400);
  });

  it("is rate limited per IP", async () => {
    client.current = makeClient({ security_rate_limit_hit: { data: false } });
    expect((await (await load("log-funnel-step"))(makeRequest({ step: "review" }))).status).toBe(429);
  });

  it("is not warmed: a warm-up ping gets no special treatment", async () => {
    expect((await (await load("log-funnel-step"))(warmupRequest())).status).toBe(403);
  });

  it("hides a failed write behind a generic error", async () => {
    client.current = makeClient({ record_funnel_step: { error: { code: "42501", message: "permission denied" } } });
    const res = await (await load("log-funnel-step"))(makeRequest({ step: "review" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("permission");
  });
});
