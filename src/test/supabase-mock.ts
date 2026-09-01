import { vi } from "vitest";

// Test helper for the service layer. Supabase's query builder is chainable and
// awaitable (`from(t).select().eq().limit()` then `await`), so this returns a stub
// where every builder method returns the same object and awaiting it (or a terminal
// like `single()`) resolves to a caller-supplied `{ data, error }`.

type Result<T> = { data: T; error: unknown };

const BUILDER_METHODS = [
  "select", "insert", "update", "delete", "upsert",
  "eq", "neq", "in", "lte", "gte", "order", "limit", "single", "maybeSingle",
] as const;

export const queryResult = <T>(result: Result<T>) => {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: Result<T>) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of BUILDER_METHODS) {
    builder[method] = vi.fn(() => builder);
  }
  return builder;
};

// The mocked Supabase client. Test files do:
//   vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
// then configure return values per test and call resetSupabaseMock() in beforeEach.
export const supabaseMock = {
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
  storage: { from: vi.fn() },
  auth: {
    getSession: vi.fn(),
    getUser: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    updateUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  },
};

export const resetSupabaseMock = () => {
  supabaseMock.from.mockReset();
  supabaseMock.rpc.mockReset();
  supabaseMock.functions.invoke.mockReset();
  supabaseMock.storage.from.mockReset();
  Object.values(supabaseMock.auth).forEach((fn) => fn.mockReset());
};
