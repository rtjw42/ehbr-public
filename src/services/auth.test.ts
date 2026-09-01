import { describe, expect, it, vi, beforeEach } from "vitest";
import { supabaseMock, queryResult, resetSupabaseMock } from "@/test/supabase-mock";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import {
  normalizeAuthError,
  hasAdminRole,
  isDuplicateSignupResponse,
  readEdgeFunctionError,
  signInAdmin,
  verifyLiveAdminSession,
  registerAdmin,
  validateAdminInvite,
  requestPasswordReset,
  updatePassword,
  loadAdminInvites,
  createAdminInvite,
  INVITE_EXPIRY_DAYS,
  deactivateAdminInvite,
  loadMyAdminDisplayName,
  updateMyAdminDisplayName,
} from "./auth";

const session = { user: { id: "u1", email: "admin@band.com" } };

beforeEach(() => resetSupabaseMock());

describe("normalizeAuthError", () => {
  it.each([
    ["Invalid login credentials", "Wrong email or password."],
    ["User already registered", "This email is already registered. Sign in instead."],
    ["invite hook failed", "Invalid or expired invite code."],
    ["No session", "Your admin session expired. Please sign in again."],
    ["Not an admin account", "Admin access is required."],
    ["admin access could not be verified", "Admin access could not be verified. Please sign in again."],
    ["exchange code failed", "Reset link is invalid or expired."],
    ["User is banned", "This account has been disabled."],
  ])("maps %s", (input, expected) => {
    expect(normalizeAuthError(input, "fallback")).toBe(expected);
  });

  it("maps a deactivated account by error code, not just message", () => {
    // Banned sign-in surfaces code "user_banned"; we must catch it even if the
    // message is the generic credential text.
    expect(normalizeAuthError({ code: "user_banned", message: "Invalid login credentials" }, "fallback"))
      .toBe("This account has been disabled.");
  });

  it("falls back for unknown errors without leaking detail", () => {
    expect(normalizeAuthError({ message: "raw auth provider detail" }, "Could not create account."))
      .toBe("Could not create account.");
  });
});

describe("pure helpers", () => {
  it("hasAdminRole detects an admin row among many", () => {
    expect(hasAdminRole([{ role: "member" }, { role: "admin" }])).toBe(true);
    expect(hasAdminRole([{ role: "member" }, { role: null }])).toBe(false);
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole([null])).toBe(false);
  });

  it("isDuplicateSignupResponse flags an empty identities array", () => {
    expect(isDuplicateSignupResponse({ user: { identities: [] } })).toBe(true);
    expect(isDuplicateSignupResponse({ user: { identities: [{ id: "identity-1" }] } })).toBe(false);
    expect(isDuplicateSignupResponse({ ok: true })).toBe(false);
    expect(isDuplicateSignupResponse(null)).toBe(false);
  });

  it("readEdgeFunctionError prefers the structured body and falls back otherwise", async () => {
    expect(await readEdgeFunctionError({ context: new Response(JSON.stringify({ error: "edge says no" })) }, "fb")).toBe("edge says no");
    expect(await readEdgeFunctionError({ context: new Response("not json") }, "fb")).toBe("fb");
  });
});

describe("signInAdmin", () => {
  it("signs in and returns the verified admin session", async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    supabaseMock.from.mockReturnValue(queryResult({ data: [{ role: "admin" }], error: null }));

    expect(await signInAdmin({ email: "admin@band.com", password: "pw" }))
      .toEqual({ ok: true, email: "admin@band.com", session });
  });

  it("signs the user back out and throws when the account is not an admin", async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: null });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    supabaseMock.from.mockReturnValue(queryResult({ data: [{ role: "member" }], error: null }));
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });

    await expect(signInAdmin({ email: "admin@band.com", password: "pw" })).rejects.toThrow(/Admin access/);
    expect(supabaseMock.auth.signOut).toHaveBeenCalled();
  });

  it("throws on wrong credentials without reaching verification", async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    await expect(signInAdmin({ email: "x@y.com", password: "bad" })).rejects.toThrow("Wrong email or password.");
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
  });
});

describe("admin display name", () => {
  it("loads the signed-in admin's display name", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    supabaseMock.from.mockReturnValue(queryResult({ data: { display_name: "Ryan" }, error: null }));
    expect(await loadMyAdminDisplayName()).toBe("Ryan");
  });

  it("returns empty string when no profile row exists", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: null }));
    expect(await loadMyAdminDisplayName()).toBe("");
  });

  it("sanitizes and upserts the new display name for the own row", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    const builder = queryResult({ data: { display_name: "Ryan" }, error: null });
    supabaseMock.from.mockReturnValue(builder);

    expect(await updateMyAdminDisplayName("  <b>Ryan</b>  ")).toBe("Ryan");
    expect(supabaseMock.from).toHaveBeenCalledWith("admin_profiles");
    expect(builder.upsert).toHaveBeenCalledWith(
      { user_id: "u1", display_name: "Ryan" },
      { onConflict: "user_id" },
    );
  });

  it("rejects an empty display name without writing", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    await expect(updateMyAdminDisplayName("   ")).rejects.toThrow("Display name is required.");
  });
});

describe("verifyLiveAdminSession", () => {
  it("throws when there is no live session", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(verifyLiveAdminSession()).rejects.toThrow(/session expired/i);
  });

  it("throws when the live session is not an admin", async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    supabaseMock.from.mockReturnValue(queryResult({ data: [], error: null }));
    await expect(verifyLiveAdminSession()).rejects.toThrow(/Admin access could not be verified/);
  });
});

describe("registerAdmin", () => {
  const base = { email: "a@b.com", password: "pw12345a", inviteCode: "EB-1", emailRedirectTo: "/x", turnstileToken: "t" };

  it("invokes register-admin and reports email confirmation", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { needsEmailConfirmation: true }, error: null });
    expect(await registerAdmin(base)).toEqual({ needsEmailConfirmation: true });
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith("register-admin", expect.any(Object));
  });

  it("detects a duplicate signup response", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { user: { identities: [] } }, error: null });
    await expect(registerAdmin(base)).rejects.toThrow("This email is already registered. Sign in instead.");
  });

  it("normalizes an edge error field", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { error: "invite invalid" }, error: null });
    await expect(registerAdmin({ ...base, inviteCode: "bad" })).rejects.toThrow("Invalid or expired invite code.");
  });
});

describe("invite-gated edge calls", () => {
  it("validateAdminInvite resolves when the edge returns ok", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(validateAdminInvite({ inviteCode: "EB-1" })).resolves.toBeUndefined();
  });

  it("validateAdminInvite throws when the edge does not confirm", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { ok: false }, error: null });
    await expect(validateAdminInvite({ inviteCode: "EB-1" })).rejects.toThrow("Invalid or expired invite code.");
  });

  it("requestPasswordReset invokes the reset edge function", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await requestPasswordReset({ email: "a@b.com", turnstileToken: "t", redirectTo: "/r" });
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith("request-password-reset", expect.any(Object));
  });
});

describe("invite management", () => {
  it("updatePassword calls auth.updateUser", async () => {
    supabaseMock.auth.updateUser.mockResolvedValue({ error: null });
    await updatePassword("new-pw");
    expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: "new-pw" });
  });

  it("loadAdminInvites returns rows", async () => {
    const rows = [{ id: "1", label: "Leader" }];
    supabaseMock.from.mockReturnValue(queryResult({ data: rows, error: null }));
    expect(await loadAdminInvites()).toEqual(rows);
  });

  it("createAdminInvite stores only a hash and returns a readable code", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    const { code } = await createAdminInvite({ label: "Leader", maxUses: 3 });
    expect(code).toMatch(/^EB-2026-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const inserted = (builder.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted).toHaveProperty("code_hash");
    expect(inserted).not.toHaveProperty("code");
    expect(inserted.max_uses).toBe(3);
  });

  it("createAdminInvite always stamps a 7-day expiry", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    const before = Date.now();
    await createAdminInvite({ label: "Leader", maxUses: 1 });
    const inserted = (builder.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Stamped after `before`, so the delta is 7 days plus however long the call took.
    const expiresIn = new Date(inserted.expires_at).getTime() - before;
    expect(expiresIn).toBeGreaterThanOrEqual(INVITE_EXPIRY_DAYS * 86_400_000);
    expect(expiresIn).toBeLessThan(INVITE_EXPIRY_DAYS * 86_400_000 + 5_000);
  });

  it("createAdminInvite clamps max uses into 1..20", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: null }));
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await createAdminInvite({ label: "", maxUses: 999 });
    expect((builder.insert as ReturnType<typeof vi.fn>).mock.calls[0][0].max_uses).toBe(20);
  });

  it("deactivateAdminInvite flips active to false for the id", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await deactivateAdminInvite("inv-1");
    expect(builder.update).toHaveBeenCalledWith({ active: false });
    expect(builder.eq).toHaveBeenCalledWith("id", "inv-1");
  });
});
