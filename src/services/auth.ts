// ── Auth service ─────────────────────────────────────────────────────────────
// Sessions, admin-role verification, sign-in/out, registration, invite management,
// and password reset. Two principles run through this file:
//   • Admin status is ALWAYS verified server-side against the user_roles table for
//     the live session — never inferred from frontend state. verifyLiveAdminSession
//     is the gate every privileged action calls before it runs.
//   • Public flows (register, validate-invite, password reset) go through Edge
//     Functions (Turnstile + rate limit), not direct Supabase auth calls.
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { stripHtmlText } from "@/lib/sanitize";

// ── Types ────────────────────────────────────────────────────────────────────
// Only the fields the admin UI displays — deliberately excludes code_hash and
// created_by so credential material never ships to the client.
export type AdminInvite = Pick<
  Tables<"admin_invite_codes">,
  "id" | "label" | "active" | "max_uses" | "used_count" | "expires_at" | "last_used_at"
>;

export type AdminSessionState =
  | { status: "signed-out" }
  | { status: "admin"; email: string; session: Session; isHead: boolean; isOwner: boolean }
  | { status: "not-admin"; email: string };

// Owner / Band Head / Band Leader. A staff member is any admin; the flags add the
// extra tiers on top (head = invites, owner = role management).
export type StaffMember = {
  userId: string;
  displayName: string;
  email: string;
  isHead: boolean;
  isOwner: boolean;
  // Deactivated = banned at the auth layer (login blocked) but still listed; the
  // owner can reactivate (unban). The admin role is kept while banned.
  isBanned: boolean;
};

export type VerifiedAdminSession = {
  ok: true;
  email: string;
  session: Session;
};

export type SignInAdminInput = {
  email: string;
  password: string;
};

export type RegisterAdminInput = {
  email: string;
  password: string;
  inviteCode: string;
  emailRedirectTo: string;
  turnstileToken: string;
};

export type RegisterAdminResult = {
  needsEmailConfirmation: boolean;
};

export type ValidateAdminInviteInput = {
  inviteCode: string;
};

export type RequestPasswordResetInput = {
  email: string;
  turnstileToken: string;
  redirectTo: string;
};

export type CreateAdminInviteInput = {
  label: string;
  maxUses: number;
};

// Every invite lives exactly this long. Not a choice: an invite is handed over in
// person and claimed within the week, so a picker only ever offered ways to get it
// wrong (a never-expiring admin code being the worst of them).
export const INVITE_EXPIRY_DAYS = 7;

export const ADMIN_DISPLAY_NAME_MAX = 60;

// ── Error normalization ──────────────────────────────────────────────────────
// Collapse Supabase/Edge auth errors into a small set of safe messages. Notably,
// invite/credential failures are deliberately vague so the form can't be used to
// probe which emails or invite codes exist.
const messageFromUnknown = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

// Supabase AuthApiError carries a stable `code` (e.g. "user_banned") that is more
// reliable than the human message, which can vary or be localized. Empty when the
// caller passed a plain string (e.g. an Edge Function's error text).
const codeFromUnknown = (error: unknown) => {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
};

export const normalizeAuthError = (error: unknown, fallback: string) => {
  const code = codeFromUnknown(error);
  const message = messageFromUnknown(error);
  // A deactivated (banned) account: sign-in fails with code "user_banned". Match the
  // code first (authoritative), then the message as a fallback, and place this before
  // the credential case so a banned admin gets the clear reason — not "wrong password".
  if (code === "user_banned" || /banned|account.*(disabled|deactivated)|has been disabled/i.test(message)) {
    return "This account has been disabled.";
  }
  if (/invalid login credentials|wrong email|wrong password/i.test(message)) return "Wrong email or password.";
  if (/already registered|already exists|email.*exists|user.*registered/i.test(message)) {
    return "This email is already registered. Sign in instead.";
  }
  if (/invite|database|trigger|hook/i.test(message)) return "Invalid or expired invite code.";
  if (/no session|session expired|auth session missing/i.test(message)) {
    return "Your admin session expired. Please sign in again.";
  }
  if (/not an admin|admin access is required/i.test(message)) return "Admin access is required.";
  if (/owner access required/i.test(message)) return "Owner access is required.";
  if (/cannot deactivate yourself/i.test(message)) return "You can’t deactivate yourself.";
  if (/cannot deactivate an owner/i.test(message)) return "You can’t deactivate an owner.";
  if (/admin access could not be verified|role/i.test(message)) {
    return "Admin access could not be verified. Please sign in again.";
  }
  if (/reset link|exchange code|invalid.*code/i.test(message)) return "Reset link is invalid or expired.";
  return fallback;
};

const throwAuthError = (error: unknown, fallback: string): never => {
  throw new Error(normalizeAuthError(error, fallback));
};

export const hasAdminRole = (rows: Array<{ role: string | null } | null> | null | undefined) => (
  !!rows?.some((row) => row?.role === "admin")
);

export const isDuplicateSignupResponse = (data: unknown) => {
  if (!data || typeof data !== "object" || !("user" in data)) return false;
  const user = (data as { user?: { identities?: unknown } | null }).user;
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
};

export const readEdgeFunctionError = async (error: unknown, fallback: string) => {
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Keep the safe fallback below.
    }
  }
  return messageFromUnknown(error) || fallback;
};

// ── Session & admin-role verification ────────────────────────────────────────
// The security core. loadAdminStateForSession queries user_roles for the live
// session; verifyLiveAdminSession is the hard gate privileged actions await before
// touching anything.
// An admin reads only their OWN capability row (RLS-enforced). Missing row or any
// error → no extra tiers (plain Band Leader), so the privileged UI stays hidden.
const loadOwnCapabilities = async (userId: string): Promise<{ isHead: boolean; isOwner: boolean }> => {
  const { data } = await supabase
    .from("admin_capabilities")
    .select("is_head, is_owner")
    .eq("user_id", userId)
    .maybeSingle();
  return { isHead: data?.is_head ?? false, isOwner: data?.is_owner ?? false };
};

const loadAdminStateForSession = async (session: Session): Promise<Exclude<AdminSessionState, { status: "signed-out" }>> => {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", session.user.id)
    .limit(10);

  if (error) throwAuthError(error, "Admin access could not be verified. Please sign in again.");

  const email = session.user.email ?? "";
  if (!hasAdminRole(data)) return { status: "not-admin", email };

  const { isHead, isOwner } = await loadOwnCapabilities(session.user.id);
  return { status: "admin", email, session, isHead, isOwner };
};

export const getCurrentSession = async () => {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throwAuthError(error, "Your admin session expired. Please sign in again.");
  return session;
};

export const subscribeToAuthChanges = (
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) => {
  const { data: sub } = supabase.auth.onAuthStateChange(callback);
  return () => sub.subscription.unsubscribe();
};

export const getVerifiedAdminState = async (session: Session | null): Promise<AdminSessionState> => {
  if (!session) return { status: "signed-out" };
  return loadAdminStateForSession(session);
};

export const verifyLiveAdminSession = async (): Promise<VerifiedAdminSession> => {
  const session = await getCurrentSession();
  if (!session) throw new Error("Your admin session expired. Please sign in again.");
  const state = await loadAdminStateForSession(session);
  if (state.status !== "admin") throw new Error("Admin access could not be verified. Please sign in again.");
  return { ok: true, email: state.email, session };
};

// ── Sign in / out ────────────────────────────────────────────────────────────
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throwAuthError(error, "Could not sign out.");
};

export const signInAdmin = async ({ email, password }: SignInAdminInput) => {
  const { error } = await supabase.auth.signInWithPassword({
    email: stripHtmlText(email),
    password,
  });
  if (error) throwAuthError(error, "Wrong email or password.");

  // Authenticated but not an admin → sign back out so no half-privileged session
  // lingers, and surface a generic access error.
  try {
    return await verifyLiveAdminSession();
  } catch (error: unknown) {
    await signOut();
    throwAuthError(error, "Admin access is required.");
  }
};

// ── Registration & invite validation (public — via Edge Function) ────────────
export const registerAdmin = async (input: RegisterAdminInput): Promise<RegisterAdminResult> => {
  const { data, error } = await supabase.functions.invoke("register-admin", {
    body: {
      email: stripHtmlText(input.email),
      password: input.password,
      inviteCode: stripHtmlText(input.inviteCode),
      emailRedirectTo: input.emailRedirectTo,
      turnstileToken: input.turnstileToken,
    },
  });

  if (error) {
    const message = await readEdgeFunctionError(error, "Could not create account.");
    throw new Error(normalizeAuthError(message, "Could not create account."));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(normalizeAuthError(String(data.error), "Could not create account."));
  }
  if (isDuplicateSignupResponse(data)) {
    throw new Error("This email is already registered. Sign in instead.");
  }

  const needsEmailConfirmation = !!(
    data &&
    typeof data === "object" &&
    "needsEmailConfirmation" in data &&
    data.needsEmailConfirmation
  );
  return { needsEmailConfirmation };
};

export const validateAdminInvite = async (input: ValidateAdminInviteInput) => {
  const { data, error } = await supabase.functions.invoke("register-admin", {
    body: {
      action: "validate-invite",
      inviteCode: stripHtmlText(input.inviteCode),
    },
  });

  if (error) {
    const message = await readEdgeFunctionError(error, "Invalid or expired invite code.");
    throw new Error(normalizeAuthError(message, "Invalid or expired invite code."));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(normalizeAuthError(String(data.error), "Invalid or expired invite code."));
  }
  if (!data || typeof data !== "object" || !("ok" in data) || data.ok !== true) {
    throw new Error("Invalid or expired invite code.");
  }
};

export const requestPasswordReset = async (input: RequestPasswordResetInput) => {
  const { data, error } = await supabase.functions.invoke("request-password-reset", {
    body: {
      email: stripHtmlText(input.email),
      turnstileToken: input.turnstileToken,
      redirectTo: input.redirectTo,
    },
  });

  if (error) {
    const message = await readEdgeFunctionError(error, "Could not send reset email.");
    throw new Error(normalizeAuthError(message, "Could not send reset email."));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(normalizeAuthError(String(data.error), "Could not send reset email."));
  }
};

// ── Password reset ───────────────────────────────────────────────────────────
// On return from the email link, exchange the `code` query param for a session so
// the user can set a new password.
export const preparePasswordRecoverySession = async () => {
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throwAuthError(error, "Reset link is invalid or expired.");
  }

  const session = await getCurrentSession();
  return !!session;
};

export const updatePassword = async (password: string) => {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throwAuthError(error, "Could not update password.");
};

const normalizeInviteError = (error: unknown, fallback: string) => {
  const message = messageFromUnknown(error);
  if (/network|fetch/i.test(message) || error instanceof TypeError) return "Network issue. Please try again.";
  return fallback;
};

const throwInviteError = (error: unknown, fallback: string): never => {
  throw new Error(normalizeInviteError(error, fallback));
};

// ── Invite management (admin — assume a verified session) ────────────────────
// Only the SHA-256 hash of an invite code is stored; the plaintext is shown to the
// admin once at creation and never persisted. The alphabet omits ambiguous
// characters (0/O, 1/I) so codes are easy to read aloud / type.
const generateInviteCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `EB-2026-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
};

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value.trim());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const loadAdminInvites = async (): Promise<AdminInvite[]> => {
  const { data, error } = await supabase
    .from("admin_invite_codes")
    .select("id, label, active, max_uses, used_count, expires_at, last_used_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throwInviteError(error, "Could not load invites");
  return (data ?? []) as AdminInvite[];
};

export const createAdminInvite = async (input: CreateAdminInviteInput) => {
  // Assumes caller has already verified an admin session.
  const code = generateInviteCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86_400_000).toISOString();
  const cleanLabel = stripHtmlText(input.label) || "Band leader";
  const maxUses = Math.max(1, Math.min(20, Math.trunc(input.maxUses) || 1));

  const { error } = await supabase.from("admin_invite_codes").insert({
    code_hash: codeHash,
    label: cleanLabel,
    max_uses: maxUses,
    expires_at: expiresAt,
  });

  if (error) throwInviteError(error, "Could not generate invite");
  return { code };
};

// ── Admin display name ───────────────────────────────────────────────────────
// The editable name shown publicly next to "Approved by". RLS restricts writes to
// the admin's OWN row (auth.uid() = user_id); reads are public. Assumes the caller
// has verified a live admin session before mutating.
export const loadMyAdminDisplayName = async (): Promise<string> => {
  const session = await getCurrentSession();
  if (!session) throw new Error("Your admin session expired. Please sign in again.");

  const { data, error } = await supabase
    .from("admin_profiles")
    .select("display_name")
    .eq("user_id", session.user.id)
    .limit(1)
    .maybeSingle();

  if (error) throwAuthError(error, "Could not load your display name.");
  return data?.display_name ?? "";
};

export const updateMyAdminDisplayName = async (displayName: string): Promise<string> => {
  const session = await getCurrentSession();
  if (!session) throw new Error("Your admin session expired. Please sign in again.");

  const clean = stripHtmlText(displayName).trim().slice(0, ADMIN_DISPLAY_NAME_MAX);
  if (!clean) throw new Error("Display name is required.");

  // Upsert so a missing profile row (shouldn't happen — trigger provisions it) is
  // still self-healing rather than a silent no-op.
  const { data, error } = await supabase
    .from("admin_profiles")
    .upsert({ user_id: session.user.id, display_name: clean }, { onConflict: "user_id" })
    .select("display_name")
    .single();

  if (error) throwAuthError(error, "Could not save your display name.");
  return data?.display_name ?? clean;
};

export const deactivateAdminInvite = async (inviteId: string) => {
  // Assumes caller has already verified an admin session.
  const { error } = await supabase
    .from("admin_invite_codes")
    .update({ active: false })
    .eq("id", inviteId);

  if (error) throwInviteError(error, "Could not deactivate invite");
};

// ── Staff / role management (owner-only; RPCs re-check is_org_owner server-side) ─
export const loadStaff = async (): Promise<StaffMember[]> => {
  const { data, error } = await supabase.rpc("list_staff");
  if (error) throwAuthError(error, "Could not load staff.");
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    isHead: row.is_head,
    isOwner: row.is_owner,
    isBanned: row.is_banned,
  }));
};

export const setBandHead = async (userId: string, makeHead: boolean) => {
  const { error } = await supabase.rpc("set_band_head", { _target_user_id: userId, _make_head: makeHead });
  if (error) throwAuthError(error, "Could not update the role.");
};

// Deactivate (active=false) bans the staffer at the auth layer; reactivate
// (active=true) unbans them. Both go through the owner-only set-staff-ban Edge
// Function, which re-verifies the caller server-side. The admin role is kept
// throughout, so a deactivated person stays listed and reactivation is just an
// unban. functions.invoke attaches the live session's bearer token automatically.
export const setStaffActive = async (userId: string, active: boolean) => {
  const { data, error } = await supabase.functions.invoke("set-staff-ban", {
    body: { targetUserId: userId, ban: !active },
  });

  const fallback = active ? "Could not reactivate this person." : "Could not deactivate this person.";
  if (error) {
    const message = await readEdgeFunctionError(error, fallback);
    throw new Error(normalizeAuthError(message, fallback));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(normalizeAuthError(String(data.error), fallback));
  }
};
