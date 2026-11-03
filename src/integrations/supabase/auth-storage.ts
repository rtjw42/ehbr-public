// ── Auth storage adapter ─────────────────────────────────────────────────────
// Owner-approved exception (2026-07-05) to the "sessionStorage only" rule: admin
// login persists across browser restarts via localStorage, behind a "Keep me
// signed in" toggle (default ON). Rationale recorded in CLAUDE.md —
// admin-only login, strict CSP (no unsafe-inline scripts), server-side role
// re-verification on every privileged action, and refresh-token rotation bound
// the residual risk. A 14-day idle timeout (below) caps how long a token can
// sit untouched at rest.
//
// Shape: Supabase gets ONE storage object (this adapter). A tiny non-sensitive
// flag picks the real store per write — localStorage when persistence is on
// (default), sessionStorage when off. Three safeguards, per the plan:
//   1. Toggling migrates the live sb-* token between stores (prefix-match on
//      the `sb-<ref>-auth-token` convention) so "off" takes effect immediately.
//   2. Every write deletes the twin key from the other store — no stale copy.
//   3. removeItem (sign-out) clears BOTH stores.
// All storage access is try/catch-wrapped: private-mode/quota failures degrade
// to "not persisted", never to a crash.

const PERSIST_FLAG_KEY = "ehbr-auth-persist";      // "1" (default when absent) | "0"
const LAST_ACTIVE_KEY = "ehbr-auth-last-active";   // epoch ms of last app activity
const IDLE_NOTICE_KEY = "ehbr-auth-idle-signout";  // set when the idle purge fired
const SUPABASE_KEY_PREFIX = "sb-";                 // Supabase auth keys: sb-<ref>-auth-token
const IDLE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;    // 14 days (owner-chosen)

const safeGet = (store: Storage, key: string): string | null => {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (store: Storage, key: string, value: string) => {
  try {
    store.setItem(key, value);
  } catch {
    // Quota/private-mode failure → session just won't persist; never throw.
  }
};

const safeRemove = (store: Storage, key: string) => {
  try {
    store.removeItem(key);
  } catch {
    // Ignore — worst case a stale key lingers until the store itself clears.
  }
};

const listSupabaseKeys = (store: Storage): string[] => {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(SUPABASE_KEY_PREFIX)) keys.push(key);
    }
  } catch {
    // Unreadable store → treat as empty.
  }
  return keys;
};

export const isPersistEnabled = (): boolean =>
  safeGet(localStorage, PERSIST_FLAG_KEY) !== "0";

// Sets the flag AND physically migrates any live sb-* token into the newly
// chosen store — flipping the toggle must take effect now, not at next login.
export const setPersistEnabled = (on: boolean) => {
  safeSet(localStorage, PERSIST_FLAG_KEY, on ? "1" : "0");
  const from = on ? sessionStorage : localStorage;
  const to = on ? localStorage : sessionStorage;
  for (const key of listSupabaseKeys(from)) {
    const value = safeGet(from, key);
    if (value !== null) safeSet(to, key, value);
    safeRemove(from, key);
  }
};

// ── 14-day idle timeout ──────────────────────────────────────────────────────
// "Idle" = last ACTIVITY (visit / sign-in / token refresh), not a hard cap from
// login. AdminContext stamps this whenever a live session is seen.
export const stampAuthActivity = () => {
  safeSet(localStorage, LAST_ACTIVE_KEY, String(Date.now()));
};

// Runs once at startup, BEFORE the Supabase client is created, so an expired
// token is gone before anything can rehydrate from it. A pre-existing session
// with no stamp (first deploy of this feature) is stamped now, not purged —
// never log an active admin out on upgrade.
export const purgeIfIdleExpired = () => {
  const tokenKeys = [...listSupabaseKeys(localStorage), ...listSupabaseKeys(sessionStorage)];
  if (tokenKeys.length === 0) return;
  const stamp = Number(safeGet(localStorage, LAST_ACTIVE_KEY));
  if (!Number.isFinite(stamp) || stamp <= 0) {
    stampAuthActivity();
    return;
  }
  if (Date.now() - stamp <= IDLE_LIMIT_MS) return;
  for (const key of tokenKeys) {
    safeRemove(localStorage, key);
    safeRemove(sessionStorage, key);
  }
  safeRemove(localStorage, LAST_ACTIVE_KEY);
  // Leave a note for AdminContext to toast — a silent logout reads as a bug.
  safeSet(localStorage, IDLE_NOTICE_KEY, "1");
};

// Read-and-clear: AdminContext consumes this on mount to show the one toast.
export const consumeIdleSignOutNotice = (): boolean => {
  const fired = safeGet(localStorage, IDLE_NOTICE_KEY) === "1";
  if (fired) safeRemove(localStorage, IDLE_NOTICE_KEY);
  return fired;
};

// ── The adapter Supabase talks to ────────────────────────────────────────────
// getItem checks both stores (active first) so a session written under the
// other flag state is still found — self-healing rather than silently signed
// out. setItem enforces the single-copy invariant; removeItem clears both.
export const authStorage = {
  getItem: (key: string): string | null => {
    const active = isPersistEnabled() ? localStorage : sessionStorage;
    const other = isPersistEnabled() ? sessionStorage : localStorage;
    return safeGet(active, key) ?? safeGet(other, key);
  },
  setItem: (key: string, value: string) => {
    const persist = isPersistEnabled();
    safeSet(persist ? localStorage : sessionStorage, key, value);
    safeRemove(persist ? sessionStorage : localStorage, key);
  },
  removeItem: (key: string) => {
    safeRemove(localStorage, key);
    safeRemove(sessionStorage, key);
  },
};
