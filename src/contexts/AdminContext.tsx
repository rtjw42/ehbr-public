import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AdminContext, type AdminContextValue } from "@/contexts/admin-context";

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [adminPanelClosing, setAdminPanelClosing] = useState(false);
  const [adminUiExiting, setAdminUiExiting] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const uiExitTimer = useRef<number | null>(null);
  const adminUiExitingRef = useRef(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

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
    }, 460);
  }, [clearUiExitTimer]);

  const closeWithAnimation = useCallback((afterClose?: () => void | Promise<void>) => {
    clearCloseTimer();
    if (!adminPanelOpen) {
      setAdminPanelClosing(false);
      void afterClose?.();
      return;
    }
    setAdminPanelClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setAdminPanelOpen(false);
      setAdminPanelClosing(false);
      closeTimer.current = null;
      void afterClose?.();
    }, 420);
  }, [adminPanelOpen, clearCloseTimer]);

  const checkSession = useCallback(async (session: Session | null) => {
    if (!session) {
      const exiting = adminUiExiting || adminUiExitingRef.current;
      if (isAdmin || exiting) {
        beginAdminUiExit();
      }
      setIsAdmin(false);
      setUserEmail("");
      if (!exiting) {
        setAdminPanelOpen(false);
        setAdminPanelClosing(false);
      }
      setAuthChecked(true);
      return;
    }

    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);

    if (error) {
      toast.error(error.message);
      setIsAdmin(false);
      setUserEmail(session.user.email ?? "");
      setAdminPanelOpen(false);
      setAdminPanelClosing(false);
      setAuthChecked(true);
      return;
    }

    const admin = !!data?.some((row) => row.role === "admin");
    setIsAdmin(admin);
    setUserEmail(session.user.email ?? "");
    if (!admin) {
      if (isAdmin || adminUiExiting) {
        beginAdminUiExit();
      } else {
        setAdminPanelOpen(false);
        setAdminPanelClosing(false);
        setAdminUiExiting(false);
      }
    }
    setAuthChecked(true);
  }, [adminUiExiting, beginAdminUiExit, isAdmin]);

  const refreshAdmin = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await checkSession(session);
  }, [checkSession]);

  useEffect(() => {
    void refreshAdmin();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void checkSession(session), 0);
    });
    return () => {
      clearCloseTimer();
      clearUiExitTimer();
      sub.subscription.unsubscribe();
    };
  }, [checkSession, refreshAdmin, clearCloseTimer, clearUiExitTimer]);

  const openAdminPanel = useCallback(() => {
    if (!isAdmin) return;
    clearCloseTimer();
    clearUiExitTimer();
    adminUiExitingRef.current = false;
    setAdminPanelClosing(false);
    setAdminUiExiting(false);
    setAdminPanelOpen(true);
  }, [isAdmin, clearCloseTimer, clearUiExitTimer]);

  const closeAdminPanel = useCallback(() => {
    closeWithAnimation();
  }, [closeWithAnimation]);

  const signOutAdmin = useCallback(async () => {
    beginAdminUiExit();
    clearCloseTimer();
    setAdminPanelClosing(true);
    setIsAdmin(false);
    setUserEmail("");
    closeTimer.current = window.setTimeout(() => {
      setAdminPanelOpen(false);
      setAdminPanelClosing(false);
      closeTimer.current = null;
    }, 420);
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(error.message);
  }, [beginAdminUiExit, clearCloseTimer]);

  const ensureAdminSession = useCallback(async () => {
    if (!isAdmin) {
      toast.error("Admin access is required.");
      closeWithAnimation();
      return false;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Your admin session expired. Please sign in again.");
      setIsAdmin(false);
      setUserEmail("");
      setAdminPanelOpen(false);
      setAdminPanelClosing(false);
      beginAdminUiExit();
      return false;
    }

    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);

    if (error || !data?.some((row) => row.role === "admin")) {
      toast.error("Admin access could not be verified. Please sign in again.");
      setIsAdmin(false);
      setUserEmail(session.user.email ?? "");
      setAdminPanelOpen(false);
      setAdminPanelClosing(false);
      beginAdminUiExit();
      return false;
    }

    return true;
  }, [isAdmin, closeWithAnimation, beginAdminUiExit]);

  const value = useMemo<AdminContextValue>(() => ({
    authChecked,
    isAdmin,
    showAdminControls: isAdmin || adminUiExiting,
    isAdminUiExiting: adminUiExiting,
    isAdminPanelOpen: (isAdmin || adminUiExiting) && (adminPanelOpen || adminPanelClosing),
    isAdminPanelClosing: adminPanelClosing,
    userEmail,
    openAdminPanel,
    closeAdminPanel,
    signOutAdmin,
    refreshAdmin,
    ensureAdminSession,
  }), [authChecked, isAdmin, adminUiExiting, adminPanelOpen, adminPanelClosing, userEmail, openAdminPanel, closeAdminPanel, signOutAdmin, refreshAdmin, ensureAdminSession]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
};
