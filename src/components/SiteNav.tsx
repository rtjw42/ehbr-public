import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Shield, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminLoginDialog } from "@/components/AdminLoginDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAdmin } from "@/hooks/useAdmin";

export const SiteNav = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [adminOpen, setAdminOpen] = useState(false);
  const { isAdmin, isAdminPanelOpen, openAdminPanel, closeAdminPanel } = useAdmin();

  useEffect(() => {
    if (searchParams.get("admin") !== "login") return;
    setAdminOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-40 border-b bg-card/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
          <Link to="/" className="grid h-10 w-10 shrink-0 place-items-center rounded-md transition-transform hover:-rotate-3 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" aria-label="Eusoff Bandits home">
            <img src="/favicon.png" alt="" className="h-8 w-8 rounded-md object-cover" />
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ThemeToggle />
            {isAdmin ? (
              <Button
                size="sm"
                onClick={isAdminPanelOpen ? closeAdminPanel : openAdminPanel}
                className="px-2.5 sm:px-3"
                variant={isAdminPanelOpen ? "default" : "outline"}
              >
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
      <div aria-hidden="true" className="h-[var(--site-nav-height)]" />
      <AdminLoginDialog open={adminOpen} onClose={() => setAdminOpen(false)} variant="dropdown" />
    </>
  );
};
