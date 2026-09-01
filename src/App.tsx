import { lazy, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Landing from "./pages/Landing.tsx";
import { SiteFooter } from "@/components/SiteFooter";
import { AdminProvider } from "@/contexts/AdminContext";
import { SiteNav } from "@/components/SiteNav";
import { PageTransition } from "@/components/PageTransition";

const Admin = lazy(() => import("./pages/Admin.tsx"));
const Index = lazy(() => import("./pages/Index.tsx"));
const Events = lazy(() => import("./pages/Events.tsx"));
const Media = lazy(() => import("./pages/Media.tsx"));
const MediaDetail = lazy(() => import("./pages/MediaDetail.tsx"));
const Backline = lazy(() => import("./pages/Backline.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const RegistrationSuccess = lazy(() => import("./pages/RegistrationSuccess.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

const AppRoutes = () => {
  const location = useLocation();
  // Auth flow pages run under a temporary session from the email link (recovery
  // on reset, confirmation on signup). Hide the nav so that session can't be used
  // to roam the authed app — these are focused, single-purpose screens.
  const isAuthScreen =
    location.pathname === "/reset-password" || location.pathname === "/registration-success";

  // Cross-page scroll reset is owned by PageTransition. This handles same-page
  // query changes only — e.g. the bookings week ?date= — instantly (overriding
  // the global scroll-behavior: smooth so it doesn't animate).
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [location.search]);

  // Warm the main pages' lazy chunks once the browser is idle, so the first tap
  // on a nav link doesn't pay a network round-trip (the visible "slight delay"
  // on first navigation). import() of an already-fetched module is a no-op, and
  // failures are fine — the route falls back to fetching on demand. Auth/admin
  // pages are rare destinations and stay on-demand.
  useEffect(() => {
    const scheduleIdle = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => (
      window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1500)
    ));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const idleId = scheduleIdle(() => {
      void Promise.allSettled([
        import("./pages/Index.tsx"),
        import("./pages/Events.tsx"),
        import("./pages/Media.tsx"),
        import("./pages/MediaDetail.tsx"),
        import("./pages/Backline.tsx"),
      ]);
    }, { timeout: 4000 });
    return () => cancelIdle(idleId);
  }, []);

  return (
    <>
      {/* The textured backdrop is the root canvas itself now (html in globals.css), so
          there's no separate fixed layer here to misalign or track Safari's bottom bar. */}
      <div className="flex min-h-[100lvh] flex-col">
        {!isAuthScreen && <SiteNav />}
        {/* PageTransition owns the Suspense boundary, the cross-page scroll reset,
            and the per-route CSS enter animation (.page-enter). */}
        <PageTransition>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/bookings" element={<Index />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/events" element={<Events />} />
            <Route path="/media" element={<Media />} />
            <Route path="/media/:eventId" element={<MediaDetail />} />
            <Route path="/backline" element={<Backline />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/registration-success" element={<RegistrationSuccess />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </PageTransition>
        <SiteFooter />
      </div>
    </>
  );
};

const App = () => (
  <TooltipProvider>
    <Sonner />
    {/* v7_startTransition ON: it keeps the current page mounted until the next
        lazy chunk resolves, so cold navigations don't blank — the new page's
        .page-enter slide then plays on already-rendered content. */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AdminProvider>
        <AppRoutes />
      </AdminProvider>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
