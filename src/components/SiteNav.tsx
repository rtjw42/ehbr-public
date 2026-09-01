// ── Site navigation ──────────────────────────────────────────────────────────
// The floating capsule nav. Non-negotiable behaviors live here: scroll-dim, the
// icon micro-animations, and dropdown panels that open from the TOP (a bottom sheet
// would be shoved up by the mobile keyboard). The Preferences and Admin panels are
// anchored to the control group and height-measured so they animate cleanly.
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

const MotionNavLink = motion(Link);
import { ChevronLeft, Home, Pencil, Settings, Shield, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PreferencesMenuPanel } from "@/components/PreferencesMenu";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { motionDurations, motionEase, navPanelTransition, overlayMotion, overlayTransition } from "@/lib/motion";
import { AdminAuthMenu } from "@/components/AdminAuthMenu";
import { cn } from "@/lib/utils";

type NavPanel = "preferences" | "admin";

const MAX_NAV_PANEL_HEIGHT = 544;

// Guard the post-login `next` param against open redirects: must be a same-origin
// absolute path (not "//evil.com"), and we only ever honor "/admin".
const sanitizeNextPath = (value: string | null) => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value === "/admin" ? value : null;
};

export const SiteNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activePanel, setActivePanel] = useState<NavPanel | null>(null);
  const [adminReturnTo, setAdminReturnTo] = useState<string | null>(null);
  const [navInteracting, setNavInteracting] = useState(false);
  const controlGroupRef = useRef<HTMLDivElement>(null);
  const panelContentRef = useRef<HTMLDivElement>(null);
  const [panelAnchor, setPanelAnchor] = useState({ top: "calc(var(--site-nav-height) + 0.35rem)", right: "1.5rem" });
  const [panelMaxHeight, setPanelMaxHeight] = useState(MAX_NAV_PANEL_HEIGHT);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const { authChecked, isAdmin } = useAdmin();
  const { t } = useI18n();

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // After navigation the app scrolls to top, so the nav should be undimmed; clear
  // the dim synchronously on pathname change rather than waiting for the async
  // scroll handler.
  useLayoutEffect(() => {
    setIsScrolled(false);
  }, [location.pathname]);

  useEffect(() => {
    if (searchParams.get("admin") !== "login") return;
    if (!authChecked) return;
    const next = sanitizeNextPath(searchParams.get("next"));
    setAdminReturnTo(next);

    const cleanedParams = new URLSearchParams(searchParams);
    cleanedParams.delete("admin");
    cleanedParams.delete("next");
    setSearchParams(cleanedParams, { replace: true });

    if (isAdmin && next) {
      navigate(next, { replace: true });
      return;
    }

    setActivePanel("admin");
  }, [authChecked, isAdmin, navigate, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activePanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePanel(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePanel]);

  const showBackButton = location.pathname !== "/";
  // Contextual "← Back" pill: the nav is the single source of navigation, so the
  // media detail page gets its back affordance here (→ the /media gallery), not
  // in-page.
  const detailBackTo = /^\/media\/[^/]+$/.test(location.pathname) ? "/media" : null;
  const navIsBright = navInteracting || !!activePanel;
  const navDimmed = isScrolled && !navIsBright;
  // Scroll-dim: fade + slight shrink + lift. The home button is now fixed-size with
  // no `layout` morph, so it rides this transform smoothly like the right control
  // pill instead of fighting it.
  const navStyle = {
    opacity: navDimmed ? 0.46 : 1,
    scale: navDimmed ? 0.94 : 1,
    y: navDimmed ? -2 : 0,
  };
  const panelInitial = overlayMotion.enter;
  const panelAnimate = { ...overlayMotion.center, height: panelHeight ?? "auto" };
  const panelExit = overlayMotion.exit;
  const panelTransition = navPanelTransition;
  // btn-interactive only — the press-scale already comes from the Button base
  // (buttonPressClass lives in the Button cva), so adding it here was redundant.
  const navControlClass = "btn-interactive";
  // Icon micro-interactions are Tier-1 motion: always on, even under iOS
  // Low Power Mode, so the nav doesn't feel inert on mobile.
  const navIconMotionClass = "transform-gpu transition-transform duration-slow ease-smooth-transition";

  const openPanel = (panel: NavPanel) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  const closePanel = () => setActivePanel(null);

  // Single source of truth for panel geometry: anchor (position), max-height and
  // the measured content height (which framer animates → the morph). Computed in
  // one pre-paint pass so the panel never flashes at a stale anchor and never
  // fires competing measurement renders. The ResizeObserver + window-resize both
  // re-run the same sync, watching the natural-height content node (never the
  // animated wrapper) so there's no feedback loop. Re-runs on open and on every
  // switch (activePanel change); a switch only re-measures, it never remounts.
  useLayoutEffect(() => {
    if (!activePanel) {
      setPanelHeight(null);
      return;
    }
    const group = controlGroupRef.current;
    const node = panelContentRef.current;
    if (!group || !node) return;

    const syncPanel = () => {
      // Anchor to the control group's *resting* geometry. The group lives inside the
      // scroll-dim wrapper, which framer scales (0.94) + translates; getBoundingClientRect()
      // would capture that transform mid-animation. offsetTop/Left are pre-transform layout
      // metrics — BUT each is relative to the nearest *offsetParent*, and a transformed
      // ancestor BECOMES that offsetParent. So while scrolled (dim transform present), a
      // single group.offsetTop flips to the shrunken wrapper's frame and reads too small —
      // the panel then anchors under the bar (overlap). Summing offsetTop/Left up the whole
      // chain to the viewport is transform- and offsetParent-flip-independent: it's the same
      // resting position whether or not a transformed ancestor sits in between.
      let topSum = 0;
      let leftSum = 0;
      for (let el: HTMLElement | null = group; el; el = el.offsetParent as HTMLElement | null) {
        topSum += el.offsetTop;
        leftSum += el.offsetLeft;
      }
      const rightEdge = leftSum + group.offsetWidth;
      const bottomEdge = topSum + group.offsetHeight;
      const top = Math.round(bottomEdge + 8);
      const availableHeight = Math.max(220, Math.floor(window.innerHeight - top - 16));
      const maxHeight = Math.min(MAX_NAV_PANEL_HEIGHT, availableHeight);
      // Anchor against the scrollbar-excluded layout width (clientWidth), not
      // window.innerWidth: the pill's edge and the panel's fixed `right` both live
      // in layout space, so innerWidth would over-inset the panel by the scrollbar.
      const layoutWidth = document.documentElement.clientWidth;
      setPanelAnchor({
        top: `${top}px`,
        right: `${Math.max(8, Math.round(layoutWidth - rightEdge))}px`,
      });
      setPanelMaxHeight(maxHeight);
      setPanelHeight(Math.min(Math.ceil(node.scrollHeight) + 2, maxHeight));
    };

    syncPanel();
    const observer = new ResizeObserver(syncPanel);
    observer.observe(node);
    window.addEventListener("resize", syncPanel);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncPanel);
    };
  }, [activePanel]);

  const handleSignedIn = () => {
    const next = adminReturnTo;
    setAdminReturnTo(null);
    if (next) navigate(next, { replace: true });
  };

  const handleSignedOut = () => {
    setAdminReturnTo(null);
    if (location.pathname === "/admin") {
      navigate("/", { replace: true });
    }
  };

  return (
    <>
      {/* pt uses the safe-area inset (viewport-fit=cover) so the floating capsule
          clears the notch/status bar; max() keeps the normal gap on non-notched. */}
      <header className="fixed inset-x-0 top-0 z-[60] px-2 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <motion.div
          className={cn(
            "mx-auto flex w-full max-w-7xl origin-top transform-gpu items-center justify-between gap-2",
            "transition-[opacity,transform] duration-base ease-out",
          )}
          style={navStyle}
          onHoverStart={() => setNavInteracting(true)}
          onHoverEnd={() => setNavInteracting(false)}
          onFocusCapture={() => setNavInteracting(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setNavInteracting(false);
            }
          }}
        >
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
            <MotionNavLink
              to="/"
              // Fixed-size pill — no `layout`/size morph, so the button rides the
              // scroll-dim transform as smoothly as the right control pill. (The old
              // roughness came from framer `layout` projecting under that scale.)
              // Content cross-slides between states inside the clipped pill; press is
              // whileTap, CSS transition is colors-only.
              whileTap={{ scale: 0.97, transition: { duration: motionDurations.tap, ease: motionEase.enter } }}
              className="group relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card/95 text-foreground shadow-sm transition-[background-color,color,border-color,box-shadow] duration-fast ease-standard hover:border-interactive-border hover:bg-interactive hover:text-interactive-text focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] dark:shadow-none sm:bg-card/82 sm:shadow-md"
              aria-label={t("nav.home")}
            >
              <AnimatePresence initial={false}>
                {showBackButton ? (
                  <motion.span
                    key="home-back"
                    className="absolute inset-0 flex items-center justify-center"
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -14 }}
                    transition={{ duration: motionDurations.base, ease: motionEase.enter }}
                  >
                    <Home className={cn("h-5 w-5 shrink-0", navIconMotionClass, "group-hover:scale-105 group-active:scale-105")} />
                  </motion.span>
                ) : (
                  <motion.span
                    key="home-logo"
                    className="absolute inset-0 flex items-center justify-center"
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 14 }}
                    transition={{ duration: motionDurations.base, ease: motionEase.enter }}
                  >
                    {/* Logo fills the pill (object-cover crops the square favicon to
                        the circle) — the button's own border is the only outline, so
                        there's no extra ring hugging the icon. */}
                    <img
                      src="/favicon.png"
                      alt=""
                      className={cn("h-full w-full rounded-full object-cover", navIconMotionClass, "group-hover:scale-105 group-active:scale-105")}
                    />
                  </motion.span>
                )}
              </AnimatePresence>
            </MotionNavLink>
            <AnimatePresence initial={false}>
              {detailBackTo && (
                <MotionNavLink
                  key="detail-back"
                  to={detailBackTo}
                  aria-label={t("nav.back")}
                  whileTap={{ scale: 0.97, transition: { duration: motionDurations.tap, ease: motionEase.enter } }}
                  initial={{ opacity: 0, x: -10, width: 0 }}
                  animate={{ opacity: 1, x: 0, width: "auto" }}
                  exit={{ opacity: 0, x: -10, width: 0 }}
                  transition={{ duration: motionDurations.base, ease: motionEase.enter }}
                  className="group flex h-11 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-border bg-card/95 pl-2.5 pr-3.5 text-sm font-semibold text-foreground shadow-sm transition-[background-color,color,border-color,box-shadow] duration-fast ease-standard hover:border-interactive-border hover:bg-interactive hover:text-interactive-text focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] dark:shadow-none sm:bg-card/82 sm:shadow-md"
                >
                  <ChevronLeft className={cn("h-5 w-5 shrink-0", navIconMotionClass, "group-hover:-translate-x-0.5 group-active:-translate-x-0.5")} />
                  {t("nav.back")}
                </MotionNavLink>
              )}
            </AnimatePresence>
          </div>
          <div ref={controlGroupRef} className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/95 px-1.5 py-1.5 text-foreground shadow-sm dark:shadow-none sm:gap-2 sm:bg-card/82 sm:px-2 sm:shadow-md"
          >
            {isAdmin && (
              <div>
                <Button
                  asChild
                  size="sm"
                  variant={location.pathname === "/admin" ? "default" : "ghost"}
                  className={cn("group h-8 rounded-full px-2 text-[0.68rem] font-black tracking-tight sm:px-3", navControlClass)}
                >
                  <Link to="/admin" aria-label={t("nav.manage")} onClick={closePanel}>
                    <Pencil className={cn("h-4 w-4", navIconMotionClass, "group-hover:-rotate-6 group-active:rotate-0")} />
                    <span className="hidden min-[380px]:inline">{t("nav.manage")}</span>
                  </Link>
                </Button>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("preferences.open")}
              aria-expanded={activePanel === "preferences"}
              data-state={activePanel === "preferences" ? "open" : "closed"}
              onClick={() => openPanel("preferences")}
              className={cn("group h-8 w-8 rounded-full px-0", navControlClass)}
            >
              <Settings className={cn("h-4 w-4", navIconMotionClass, "group-data-[state=open]:rotate-45 group-active:rotate-90")} />
            </Button>
            <div className="h-5 w-px bg-border" aria-hidden="true" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t("nav.admin")}
              aria-expanded={activePanel === "admin"}
              data-state={activePanel === "admin" ? "open" : "closed"}
              onClick={() => openPanel("admin")}
              className={cn("group h-8 w-8 rounded-full px-0", navControlClass)}
            >
              {isAdmin ? (
                <ShieldCheck className={cn("h-4 w-4", navIconMotionClass, "group-data-[state=open]:rotate-12 group-data-[state=open]:scale-110 group-active:scale-95")} />
              ) : (
                <Shield className={cn("h-4 w-4", navIconMotionClass, "group-data-[state=open]:rotate-6 group-active:scale-95")} />
              )}
            </Button>
          </div>
        </motion.div>
      </header>
      <AnimatePresence>
        {activePanel && (
          <>
            <motion.button
              type="button"
              aria-label={t("common.close")}
              className="fixed inset-0 z-50 cursor-default bg-black/35 md:bg-transparent"
              onClick={closePanel}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={overlayTransition}
            />
            <motion.div
              role="dialog"
              aria-modal="false"
              aria-label={activePanel === "preferences" ? t("preferences.title") : t("admin.login.dialogLabel")}
              // Panel morphs height between panels. The dominant mobile paint cost
              // was re-blurring the box-shadow as the box resizes every frame, so
              // mobile drops the shadow entirely (a dark backdrop already separates
              // it from the page); desktop keeps its shadow via md:* (it has the
              // headroom and was already smooth). Opaque mobile bg avoids per-frame
              // blending; will-change:transform (CSS) isolates the repaint layer.
              className="nav-morph-panel fixed inset-x-3 top-[var(--nav-panel-top)] z-[55] mx-auto w-auto max-w-none origin-top-right overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card dark:shadow-none md:inset-x-auto md:right-[var(--nav-panel-right)] md:mx-0 md:w-[clamp(17.5rem,26vw,23.75rem)] md:rounded-[1.55rem] md:bg-card/95 md:shadow-lg"
              initial={panelInitial}
              animate={panelAnimate}
              exit={panelExit}
              transition={{
                ...panelTransition,
                opacity: { duration: motionDurations.fast },
                height: { duration: motionDurations.fast },
              }}
              style={{
                "--nav-panel-right": panelAnchor.right,
                "--nav-panel-top": panelAnchor.top,
                transformOrigin: "top right",
                maxHeight: panelMaxHeight,
              } as CSSProperties}
            >
              <div className="nav-panel-scroll overflow-y-auto" style={{ height: panelHeight ?? undefined, maxHeight: panelMaxHeight }}>
                {/* Both panels stay mounted while open; switching toggles visibility
                    (a hidden panel contributes 0 to scrollHeight, so the measured
                    height is always the active one) so the heavy admin form never
                    remounts mid-morph. */}
                <div ref={panelContentRef}>
                  <div className={activePanel === "preferences" ? undefined : "hidden"}>
                    <PreferencesMenuPanel />
                  </div>
                  <div className={activePanel === "admin" ? undefined : "hidden"}>
                    <AdminAuthMenu onClose={closePanel} onSignedIn={handleSignedIn} onSignedOut={handleSignedOut} />
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
