// Test harness for the Edge Functions. They run on Deno; under Vitest the `Deno`
// global is a stub whose env reads come from `env` and whose `serve` only records
// the handler. security.ts reads ALLOWED_ORIGINS once at load, so every load
// resets modules and re-stubs Deno first.
import { vi } from "vitest";

export const ORIGIN = "https://site.example";

export const BASE_ENV: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  RATE_LIMIT_SALT: "salt",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  ALLOWED_ORIGINS: ORIGIN,
  WARMUP_SECRET: "warm-secret",
};

const env: Record<string, string> = {};

export const stubDeno = (values: Record<string, string>) => {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, values);
  vi.stubGlobal("Deno", { env: { get: (key: string) => env[key] }, serve: vi.fn() });
};

export const loadModule = async <T>(load: () => Promise<T>, values: Record<string, string> = BASE_ENV) => {
  vi.resetModules();
  stubDeno(values);
  return load();
};

type RequestOptions = {
  method?: string;
  origin?: string | null;
  headers?: Record<string, string>;
  rawBody?: string;
};

// A browser-like request. Content-Length is set explicitly because the size guard
// requires it, exactly as a browser sends it.
export const makeRequest = (body?: unknown, { method = "POST", origin = ORIGIN, headers = {}, rawBody }: RequestOptions = {}) => {
  const text = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const all: Record<string, string> = { ...headers };
  if (origin) all.Origin = origin;
  if (text !== undefined) {
    all["Content-Type"] = "application/json";
    all["Content-Length"] = String(new TextEncoder().encode(text).length);
  }
  return new Request("https://project.supabase.co/functions/v1/fn", { method, headers: all, body: text });
};

export const healthRequest = () =>
  makeRequest({ health: true }, { origin: null, headers: { "x-warmup-secret": "warm-secret", "x-health": "deep" } });

export const warmupRequest = () =>
  makeRequest({ warmup: true }, { origin: null, headers: { "x-warmup-secret": "warm-secret" } });

// Routes fetch by host: Turnstile, Telegram and Healthchecks.io.
export const stubFetch = ({ turnstileSuccess = true, turnstileStatus = 200 } = {}) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("challenges.cloudflare.com")) {
      return new Response(JSON.stringify({ success: turnstileSuccess }), { status: turnstileStatus });
    }
    return new Response("OK", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

// A fake supabase-js client whose RPCs answer by name.
export const makeClient = (rpcResults: Record<string, { data?: unknown; error?: unknown }> = {}) => {
  const defaults: Record<string, { data?: unknown; error?: unknown }> = {
    security_rate_limit_blocked: { data: false },
    security_rate_limit_hit: { data: true },
    ...rpcResults,
  };
  return {
    rpc: vi.fn(async (name: string) => ({ data: null, error: null, ...defaults[name] })),
    from: vi.fn(),
    auth: { signUp: vi.fn(), resetPasswordForEmail: vi.fn() },
  };
};
