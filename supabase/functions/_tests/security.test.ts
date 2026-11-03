// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE_ENV, ORIGIN, loadModule, makeRequest, stubFetch } from "./harness";

const load = (env = BASE_ENV) => loadModule(() => import("../_shared/security.ts"), env);
const rpcClient = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

afterEach(() => vi.unstubAllGlobals());

describe("CORS", () => {
  it("rejects an origin outside the allow-list with a bodyful 403", async () => {
    const { handleCors } = await load();
    const { response } = handleCors(makeRequest({}, { origin: "https://evil.example" }));
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Origin not allowed." });
  });

  it("answers an allowed preflight with the CORS headers", async () => {
    const { handleCors } = await load();
    const { response } = handleCors(makeRequest(undefined, { method: "OPTIONS" }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(response?.headers.get("Vary")).toBe("Origin");
  });

  it("lets an allowed POST through and echoes the origin on json responses", async () => {
    const { handleCors, json } = await load();
    const { origin, response } = handleCors(makeRequest({}));
    expect(response).toBeNull();
    const res = json(origin, { ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("falls back to SITE_URL and strips trailing slashes", async () => {
    const { handleCors } = await load({ ...BASE_ENV, ALLOWED_ORIGINS: "", SITE_URL: `${ORIGIN}/` });
    expect(handleCors(makeRequest({})).response).toBeNull();
  });

  it("fails closed, loudly, when no origin is configured", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handleCors } = await load({ ...BASE_ENV, ALLOWED_ORIGINS: "", SITE_URL: "" });
    expect(handleCors(makeRequest({})).response?.status).toBe(403);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("request size and body", () => {
  it("requires a Content-Length when asked to", async () => {
    const { assertRequestSize } = await load();
    const req = new Request("https://x.example", { method: "POST", body: "{}" });
    expect(() => assertRequestSize(req, 100, true)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => assertRequestSize(req, 100)).not.toThrow();
  });

  it("rejects a malformed or oversized declared length", async () => {
    const { assertRequestSize } = await load();
    const declared = (length: string) => new Request("https://x.example", { method: "POST", headers: { "Content-Length": length }, body: "{}" });
    expect(() => assertRequestSize(declared("abc"), 100)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => assertRequestSize(declared("101"), 100)).toThrow(expect.objectContaining({ status: 413 }));
  });

  it("parses a JSON body within the limit", async () => {
    const { readJsonBody } = await load();
    expect(await readJsonBody(makeRequest({ a: 1 }), 100)).toEqual({ a: 1 });
  });

  it("rejects invalid JSON as a 400", async () => {
    const { readJsonBody } = await load();
    await expect(readJsonBody(makeRequest(undefined, { rawBody: "{nope" }), 100)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a body whose real size exceeds the limit even if the header lies", async () => {
    const { readJsonBody } = await load();
    const big = JSON.stringify({ text: "x".repeat(200) });
    const lying = new Request("https://x.example", { method: "POST", headers: { "Content-Length": "10" }, body: big });
    await expect(readJsonBody(lying, 100)).rejects.toMatchObject({ status: 413 });
  });
});

describe("client IP and hashing", () => {
  it("prefers Cloudflare's header, which the client cannot forge", async () => {
    const { getClientIp } = await load();
    const req = new Request("https://x.example", { headers: { "CF-Connecting-IP": "1.1.1.1", "X-Forwarded-For": "6.6.6.6" } });
    expect(getClientIp(req)).toBe("1.1.1.1");
  });

  it("falls back to X-Forwarded-For, then X-Real-IP, warning that it can be spoofed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getClientIp } = await load();
    expect(getClientIp(new Request("https://x.example", { headers: { "X-Forwarded-For": "2.2.2.2, 3.3.3.3" } }))).toBe("2.2.2.2");
    expect(getClientIp(new Request("https://x.example", { headers: { "X-Real-IP": "4.4.4.4" } }))).toBe("4.4.4.4");
    expect(getClientIp(new Request("https://x.example"))).toBe("unknown");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("hashes deterministically with the salt, and refuses to run without one", async () => {
    const a = await (await load()).hashSubject("1.1.1.1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await load()).hashSubject("1.1.1.1")).toBe(a);
    expect(await (await load({ ...BASE_ENV, RATE_LIMIT_SALT: "other" })).hashSubject("1.1.1.1")).not.toBe(a);
    const { hashSubject } = await load({ ...BASE_ENV, RATE_LIMIT_SALT: "" });
    await expect(hashSubject("1.1.1.1")).rejects.toThrow("Rate limiting is not configured");
  });

  it("strips tags from text and blanks non-strings", async () => {
    const { stripHtmlText } = await load();
    expect(stripHtmlText(" <b>Band</b> ")).toBe("Band");
    expect(stripHtmlText(42)).toBe("");
  });
});

describe("rate limiting", () => {
  it("records a hit and reports whether it was within the limit", async () => {
    const { rateLimitHit } = await load();
    const client = rpcClient(true);
    expect(await rateLimitHit(client, "scope", "hash", 5)).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("security_rate_limit_hit", {
      _scope: "scope", _subject_hash: "hash", _max_attempts: 5, _window: "10 minutes",
    });
    expect(await rateLimitHit(rpcClient(false), "scope", "hash", 5)).toBe(false);
  });

  it("checks without recording, honouring a custom window", async () => {
    const { rateLimitBlocked } = await load();
    const client = rpcClient(true);
    expect(await rateLimitBlocked(client, "scope", "hash", 5, "1 hour")).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("security_rate_limit_blocked", expect.objectContaining({ _window: "1 hour" }));
  });

  it("throws, so callers fail closed, when the database errors", async () => {
    const { rateLimitHit, rateLimitBlocked } = await load();
    await expect(rateLimitHit(rpcClient(null, { message: "boom" }), "s", "h", 1)).rejects.toThrow("boom");
    await expect(rateLimitBlocked(rpcClient(null, {}), "s", "h", 1)).rejects.toThrow("Rate limit check failed");
  });
});

describe("Turnstile", () => {
  it("accepts a valid token, sending the secret, token and IP", async () => {
    const fetchMock = stubFetch();
    const { verifyTurnstile } = await load();
    await expect(verifyTurnstile("token", "1.1.1.1")).resolves.toBeUndefined();
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get("secret")).toBe("turnstile-secret");
    expect(form.get("response")).toBe("token");
    expect(form.get("remoteip")).toBe("1.1.1.1");
  });

  it("omits an unknown IP", async () => {
    const fetchMock = stubFetch();
    const { verifyTurnstile } = await load();
    await verifyTurnstile("token", "unknown");
    expect((fetchMock.mock.calls[0][1]?.body as FormData).has("remoteip")).toBe(false);
  });

  it("rejects a failed token or a Cloudflare outage as a 403", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch({ turnstileSuccess: false });
    await expect((await load()).verifyTurnstile("bad", "1.1.1.1")).rejects.toMatchObject({ status: 403 });
    stubFetch({ turnstileStatus: 503 });
    await expect((await load()).verifyTurnstile("token", "1.1.1.1")).rejects.toMatchObject({ status: 403 });
    warn.mockRestore();
  });

  it("refuses to run without its secret", async () => {
    const { verifyTurnstile } = await load({ ...BASE_ENV, TURNSTILE_SECRET_KEY: "" });
    await expect(verifyTurnstile("token", "1.1.1.1")).rejects.toThrow("Turnstile is not configured");
  });
});

describe("warm-up", () => {
  it("accepts only the matching secret, and never when none is configured", async () => {
    const { isWarmupRequest, warmupResponse } = await load();
    const withSecret = (secret: string) => new Request("https://x.example", { headers: { "x-warmup-secret": secret } });
    expect(isWarmupRequest(withSecret("warm-secret"))).toBe(true);
    expect(isWarmupRequest(withSecret("wrong"))).toBe(false);
    expect(await warmupResponse().json()).toEqual({ ok: true, warm: true });
    const unset = await load({ ...BASE_ENV, WARMUP_SECRET: "" });
    expect(unset.isWarmupRequest(withSecret(""))).toBe(false);
  });
});
