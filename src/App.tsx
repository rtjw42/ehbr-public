import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import Landing from "./pages/Landing.tsx";
import NotFound from "./pages/NotFound.tsx";
import Admin from "./pages/Admin.tsx";
import Events from "./pages/Events.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import RegistrationSuccess from "./pages/RegistrationSuccess.tsx";
import Backline from "./pages/Backline.tsx";
import { SmoothScroll } from "@/components/SmoothScroll";
import { SiteFooter } from "@/components/SiteFooter";
import { AdminProvider } from "@/contexts/AdminContext";
import { SiteNav } from "@/components/SiteNav";

const queryClient = new QueryClient();

const AppRoutes = () => {
  const location = useLocation();
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [pageEntering, setPageEntering] = useState(false);
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    setIsRouteLoading(true);
    setPageEntering(true);
    const loadingTimer = window.setTimeout(() => setIsRouteLoading(false), 340);
    const pageTimer = window.setTimeout(() => setPageEntering(false), 320);

    return () => {
      window.clearTimeout(loadingTimer);
      window.clearTimeout(pageTimer);
      setIsRouteLoading(false);
      setPageEntering(false);
    };
  }, [location.pathname, location.search]);

  return (
    <>
      <div className={isRouteLoading ? "route-spinner-overlay is-active" : "route-spinner-overlay"} aria-hidden="true">
        <div className="route-spinner-ring" />
      </div>
      <SiteNav />
      <SmoothScroll>
        <div key={`${location.pathname}${location.search}`} className={pageEntering ? "route-content-fade is-entering" : "route-content-fade"}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/bookings" element={<Index />} />
            <Route path="/admin" element={<Navigate to="/" replace />} />
            <Route path="/events" element={<Events />} />
            <Route path="/backline" element={<Backline />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/registration-success" element={<RegistrationSuccess />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <SiteFooter />
        </div>
        <Admin />
      </SmoothScroll>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminProvider>
          <AppRoutes />
        </AdminProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
