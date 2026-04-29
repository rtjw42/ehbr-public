import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Shield, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AdminLoginDialog } from "@/components/AdminLoginDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Session } from "@supabase/supabase-js";

export const SiteNav = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [adminOpen, setAdminOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const check = async (session: Session | null) => {
      if (!session) {
        setIsAdmin(false);
        return;
      }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id);
      setIsAdmin(!!data?.some((r) => r.role === "admin"));
    };

    supabase.auth.getSession().then(({ data: { session } }) => check(session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => check(session), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (searchParams.get("admin") !== "login") return;
    setAdminOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
          <Link to="/" className="grid h-10 w-10 shrink-0 place-items-center rounded-md transition-transform hover:-rotate-3 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" aria-label="Eusoff Bandits home">
            <img src="/favicon.png" alt="" className="h-8 w-8 rounded-md object-cover" />
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ThemeToggle />
            {isAdmin ? (
              <Button size="sm" onClick={() => navigate("/admin")} className="px-2.5 sm:px-3">
                <ShieldCheck className="h-4 w-4" /> <span className="hidden min-[360px]:inline">Admin</span>
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setAdminOpen(true)} className="px-2.5 sm:px-3">
                <Shield className="h-4 w-4" /> <span className="hidden min-[360px]:inline">Admin</span>
              </Button>
            )}
          </div>
        </div>
      </header>
      <AdminLoginDialog open={adminOpen} onClose={() => setAdminOpen(false)} variant="dropdown" />
    </>
  );
};
