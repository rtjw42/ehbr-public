import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AdminContext, type AdminContextValue } from "@/contexts/admin-context";

export const AdminProvider = ({ children }: { children: ReactNode }) => {
  const [authChecked, setAuthChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);

  const checkSession = useCallback(async (session: Session | null) => {
    if (!session) {
      setIsAdmin(false);
      setUserEmail("");
      setAdminPanelOpen(false);
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
      setAuthChecked(true);
      return;
    }

    const admin = !!data?.some((row) => row.role === "admin");
    setIsAdmin(admin);
    setUserEmail(session.user.email ?? "");
    if (!admin) setAdminPanelOpen(false);
    setAuthChecked(true);
  }, []);

  const refreshAdmin = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    await checkSession(session);
  }, [checkSession]);

  useEffect(() => {
    void refreshAdmin();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void checkSession(session), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [checkSession, refreshAdmin]);

  const openAdminPanel = useCallback(() => {
    if (isAdmin) setAdminPanelOpen(true);
  }, [isAdmin]);

  const closeAdminPanel = useCallback(() => {
    setAdminPanelOpen(false);
  }, []);

  const signOutAdmin = useCallback(async () => {
    setAdminPanelOpen(false);
    await supabase.auth.signOut();
  }, []);

  const ensureAdminSession = useCallback(async () => {
    if (!isAdmin) {
      toast.error("Admin access is required.");
      setAdminPanelOpen(false);
      return false;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Your admin session expired. Please sign in again.");
      setIsAdmin(false);
      setUserEmail("");
      setAdminPanelOpen(false);
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
      return false;
    }

    return true;
  }, [isAdmin]);

  const value = useMemo<AdminContextValue>(() => ({
    authChecked,
    isAdmin,
    isAdminPanelOpen: isAdmin && adminPanelOpen,
    userEmail,
    openAdminPanel,
    closeAdminPanel,
    signOutAdmin,
    refreshAdmin,
    ensureAdminSession,
  }), [authChecked, isAdmin, adminPanelOpen, userEmail, openAdminPanel, closeAdminPanel, signOutAdmin, refreshAdmin, ensureAdminSession]);

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
};
