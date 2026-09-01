// ── Admin auth provider ──────────────────────────────────────────────────────
// Holds the admin state that drives the admin overlay. Admin status is verified
// server-side (against user_roles) on mount and on every auth change — frontend
// state is never trusted on its own. ensureAdminSession is the per-action gate:
// privileged UI calls it to re-verify the LIVE session right before acting, and
// beginAdminUiExit animates the controls out gracefully when a session ends rather
// than letting them snap away.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { AdminContext, type AdminContextValue } from "@/contexts/admin-context";
import {
  getCurrentSession,
  getVerifiedAdminState,
  signOut,
  subscribeToAuthChanges,
  verifyLiveAdminSession,
} from "@/services/auth";
import { consumeIdleSignOutNotice, stampAuthActivity } from "@/integrations/supabase/auth-storage";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationKey } from "@/lib/i18n";

const ADMIN_PANEL_EXIT_MS = 260;

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isHead, setIsHead] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [adminUiExiting, setAdminUiExiting] = useState(false);
  const uiExitTimer = useRef<number | null>(null);
  const adminUiExitingRef = useRef(false);

  const clearUiExitTimer = useCallback(() => {
    if (uiExitTimer.current === null) return;
    window.clearTimeout(uiExitTimer.current);
    uiExitTimer.current = null;
  }, []);

  const beginAdminUiExit = useCallback(() => {
    clearUiExitTimer();
    adminUiExitingRef.current = true;
    setAdminUiExiting(true);
    uiExitTimer.current = window.setTimeout(() => {
      adminUiExitingRef.current = false;
      setAdminUiExiting(false);
      uiExitTimer.current = null;
    }, ADMIN_PANEL_EXIT_MS);
  }, [clearUiExitTimer]);

  const adminErrorMessage = useCallback((error: unknown, fallbackKey: TranslationKey) => {
    const message = error instanceof Error ? error.message : "";
    if (/session expired|auth session missing|no session/i.test(message)) return t("admin.sessionExpired");
    if (/not an admin|admin access is required/i.test(message)) return t("admin.accessRequired");
    if (/admin access could not be verified|role/i.test(message)) return t("admin.sessionVerifyFailed");
    if (/could not sign out/i.test(message)) return t("admin.signOutFailed");
    return message || t(fallbackKey);
  }, [t]);

  const checkSession = useCallback(async (session: Session | null) => {
    if (!session) {
      const exiting = adminUiExiting || adminUiExitingRef.current;
      if (isAdmin || exiting) {
        beginAdminUiExit();
      }
      setIsAdmin(false);
      setIsHead(false);
      setIsOwner(false);
      setUserEmail("");
      setAuthChecked(true);
      return;
    }

    // A live session seen = activity — feeds the 14-day idle timeout. Fires on
    // mount, sign-in, and every background token refresh (all route through here).
    stampAuthActivity();

    try {
      const state = await getVerifiedAdminState(session);
      const admin = state.status === "admin";
      setIsAdmin(admin);
      setIsHead(state.status === "admin" ? state.isHead : false);
      setIsOwner(state.status === "admin" ? state.isOwner : false);
      setUserEmail(state.status === "signed-out" ? "" : state.email);
      if (!admin) {
        if (isAdmin || adminUiExiting) {
          beginAdminUiExit();
        } else {
          setAdminUiExiting(false);
        }
      }
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, "admin.sessionVerifyFailed"));
      setIsAdmin(false);
      setIsHead(false);
      setIsOwner(false);
      setUserEmail(session.user.email ?? "");
      beginAdminUiExit();
    }
    setAuthChecked(true);
  }, [adminErrorMessage, adminUiExiting, beginAdminUiExit, isAdmin]);

  const refreshAdmin = useCallback(async () => {
    const session = await getCurrentSession();
    await checkSession(session);
  }, [checkSession]);

  // If the startup idle purge signed the admin out, say so once — a silent
  // logout after two quiet weeks would read as a bug, not a safety feature.
  useEffect(() => {
    if (consumeIdleSignOutNotice()) toast.info(t("admin.idleSignedOut"));
    // Show once per purge; `t` churn must not re-fire it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshAdmin();
    // Defer the re-check a tick so it runs after Supabase finishes applying its own
    // auth-state update for this event.
    const unsubscribe = subscribeToAuthChanges((_event, session) => {
      setTimeout(() => void checkSession(session), 0);
    });
    return () => {
      clearUiExitTimer();
      unsubscribe();
    };
  }, [checkSession, refreshAdmin, clearUiExitTimer]);

  const signOutAdmin = useCallback(async () => {
    beginAdminUiExit();
    setIsAdmin(false);
    setIsHead(false);
    setIsOwner(false);
    setUserEmail("");
    try {
      await signOut();
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, "admin.signOutFailed"));
    }
  }, [adminErrorMessage, beginAdminUiExit]);

  const ensureAdminSession = useCallback(async () => {
    if (!isAdmin) {
      toast.error(t("admin.accessRequired"));
      return false;
    }

    try {
      const verified = await verifyLiveAdminSession();
      setUserEmail(verified.email);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (/session expired/i.test(message)) {
        toast.error(t("admin.sessionExpired"));
      } else {
        toast.error(adminErrorMessage(error, "admin.sessionVerifyFailed"));
      }
      setIsAdmin(false);
      setIsHead(false);
      setIsOwner(false);
      setUserEmail("");
      beginAdminUiExit();
      return false;
    }
  }, [adminErrorMessage, beginAdminUiExit, isAdmin, t]);

  const value = useMemo<AdminContextValue>(() => ({
    authChecked,
    isAdmin,
    isHead,
    isOwner,
    showAdminControls: isAdmin || adminUiExiting,
    isAdminUiExiting: adminUiExiting,
    userEmail,
    signOutAdmin,
    refreshAdmin,
    ensureAdminSession,
  }), [authChecked, isAdmin, isHead, isOwner, adminUiExiting, userEmail, signOutAdmin, refreshAdmin, ensureAdminSession]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
};
