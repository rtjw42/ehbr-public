// ── Page transition ──────────────────────────────────────────────────────────
// The route-swap primitive AND the single owner of page entrances: wraps the
// router's <Routes>, owning the Suspense boundary, the scroll reset, and the
// per-route enter animation. New pages get the correct behaviour for free. The
// transition is CSS-only (.page-enter in globals.css): a horizontal slide on LITE
// (mobile), a fade+rise on FULL (desktop). CSS keeps it on the
// compositor, so it stays smooth while the destination page mounts — no main-thread
// lag — and the content animates in directly over the textured backdrop (no opaque
// overlay), so there's no flash. Keyed by pathname so the animation replays on each
// navigation (not on same-page query changes like the bookings ?date=). Pages render
// their content at rest — they no longer carry their own framer entrance. Exception:
// the bookings grid owns its DayBox cascade on desktop, so .page-enter is suppressed
// there (see ownsOwnEntrance) — never two systems on one content.
import { Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { getMotionTier } from "@/hooks/useMotionTier";
import { cn } from "@/lib/utils";

export const PageTransition = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  // Skips the very first paint (initial app load shouldn't slide / scroll-reset).
  const hasNavigated = useRef(false);
  useEffect(() => {
    hasNavigated.current = true;
  }, []);

  // Reset scroll to the top on navigation, before paint — instant, overriding the
  // global `scroll-behavior: smooth` so it doesn't animate.
  useLayoutEffect(() => {
    if (hasNavigated.current) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [location.pathname]);

  // The bookings grid owns its own entrance on desktop (the DayBox cascade), so
  // suppress the wrapper's .page-enter there — never two systems on one content.
  // On lite the cascade is a no-op, so the page-slide still applies as normal.
  const ownsOwnEntrance = getMotionTier() === "full" && location.pathname === "/bookings";

  return (
    // overflow-x: clip (not hidden) contains the lite slide's off-screen frames
    // without making this a scroll container — vertical scroll and pinch-zoom stay
    // intact (mobile-safety rules).
    <div className="relative flex min-h-0 min-w-0 flex-1 [overflow-x:clip]">
      <Suspense fallback={null}>
        <div
          key={location.pathname}
          className={cn("flex min-h-0 min-w-0 flex-1", hasNavigated.current && !ownsOwnEntrance && "page-enter")}
        >
          {children}
        </div>
      </Suspense>
    </div>
  );
};
