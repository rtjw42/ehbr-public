// ── Motion design system ──────────────────────────────────────────────
// Single source of truth for timing. Mirrors the CSS variables in tokens.css
// (--duration-*, --ease-*) so framer, raw CSS and Tailwind all share one scale.
// Feel: smooth, gently slower — not snappy.
import { getMotionTier } from "@/hooks/useMotionTier";
export const motionDurations = {
  tap: 0.14,   // press / active feedback        (--duration-tap)
  fast: 0.2,   // hover, color, small fades       (--duration-fast)
  base: 0.26,  // crossfades, most transitions    (--duration-base)
  slow: 0.34,  // panels, dialogs, page, icons    (--duration-slow)
} as const;

export const motionEase = {
  enter: [0.22, 1, 0.36, 1], // the one standard enter/move curve (--ease-standard)
  exit: [0.3, 0, 1, 0.7],    // leave                              (--ease-exit)
} as const;

export const overlayMotion = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
} as const;

export const overlayTransition = {
  duration: motionDurations.base,
  ease: motionEase.enter,
} as const;

export const overlayExitTransition = {
  duration: motionDurations.fast,
  ease: motionEase.exit,
} as const;

export const navPanelTransition = {
  duration: motionDurations.base,
  ease: motionEase.enter,
} as const;

// The ONE height-glide timing (Phase M2.5 — the "resize style", restored as a
// first-class citizen after the owner's on-device verdict). Every height glide
// in the app runs through <Resize> (ui/resize.tsx) on this token, and the
// dialog scroll animator (animate-scroll.ts) tweens on the SAME duration +
// curve, so a centring pan and a panel glide can never desync.
//
// Symmetric in-out curve (NOT the ease-out enter): a box morphing its height
// carries the eye across a distance and reads smoother accelerating from rest
// and settling, rather than launching at full velocity.
//
// LPM note, honestly: a height glide is per-frame main-thread work, so iOS Low
// Power caps it to ~30fps no matter who drives it (this is CSS-driven — React
// only sets endpoint values, rule #1). The pan is rAF-driven and capped the
// same way, so the pair degrades TOGETHER and stays locked — coherence over
// per-path smoothness. Full power is the design target (owner call).
export const resizeTransition = {
  duration: 0.44,
  ease: [0.4, 0, 0.2, 1],
} as const;

// The ONE in-form geometry timing (Phase N). Every FLIP — picker open/close,
// panel toggles, A↔B morphs, the scroll absorption that rides along with them —
// runs on this single token, because M2.5's core diagnosis was that "jumps" were
// 2–3 animations per interaction on DIFFERENT clocks. One token, one clock, one
// gesture, by construction rather than by keeping numbers in sync.
//
// Deliberately the same duration + symmetric in-out curve as `resizeTransition`,
// so the feel is unchanged from the height-glide it replaces — only the property
// changes (transform, not height), which is what makes it frame-rate independent
// and therefore smooth in iOS Low Power.
export const flipTransition = {
  duration: 0.44,
  ease: [0.4, 0, 0.2, 1],
} as const;

// Standard fade for swapping content inside a surface (dialog steps, view
// changes, form-panel ternaries). Pure opacity, keyed remount — the content
// swaps in place (no exit beat) and fades in while the surrounding <Resize>
// dep-glides the height between the two sizes. Fade + glide = one gesture.
export const crossfadeTransition = {
  duration: motionDurations.base,
  ease: motionEase.enter,
} as const;

// Content cascade — grid/list items "deal in" one-by-one (fade + small rise).
// The reusable vocabulary for a content reveal (distinct from the unison page
// entrance). Spread onto each motion item: {...cascadeItemProps(index, active)}.
// `active` lets callers gate it (e.g. off on the coarse-pointer lite tier);
// when false the item just appears, no animation. Only transform+opacity → GPU.
const CASCADE_STEP = 0.045; // delay between items, seconds
export const cascadeItemProps = (index: number, active: boolean) => ({
  initial: active ? { opacity: 0, y: 8 } : false,
  animate: { opacity: 1, y: 0 },
  transition: {
    delay: active ? index * CASCADE_STEP : 0,
    duration: motionDurations.slow,
    ease: motionEase.enter,
  },
});

// Routed-page entrances are owned by ONE system: the CSS .page-enter rule on the
// PageTransition wrapper (globals.css) — a slide on lite, fade+rise on full.
// Pages render their content at rest; they no longer carry
// their own framer entrance. (The bookings DayBox cascade is the single documented
// exception — see Cascade.tsx.) The only framer page-entrance left is ConsentGate,
// which renders OUTSIDE the router in main.tsx, so .page-enter never covers it.

// ConsentGate entrance — a gentle fade, with a small upward rise on the FULL tier
// only (fine-pointer desktop). On lite the rise is dropped: translating large,
// text-heavy panels re-rasterizes the type as it lands, reading as a flicker; a
// pure opacity fade stays buttery. Read once at module load from the shared motion
// authority (data-motion, written pre-paint), so JS and CSS agree.
const entranceRise = getMotionTier() === "full" ? 10 : 0;
const entranceTransition = { duration: 0.44, ease: motionEase.enter } as const;

export const consentEntrance = entranceRise
  ? ({
      hidden: { opacity: 0, y: entranceRise },
      visible: { opacity: 1, y: 0, transition: entranceTransition },
    } as const)
  : ({
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: entranceTransition },
    } as const);

// First-run splash entrance (ConsentGate step 0) — "soft settle + stagger". The
// logo fades in while scaling gently from 0.92→1 (it "arrives"); a beat later the
// `pref setup ›` affordance fades + rises in below. Both are compositor-only
// (opacity + transform), so it stays smooth in iOS Low Power at any frame rate.
export const splashLogoEntrance = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.55, ease: motionEase.enter } },
} as const;

export const splashCtaEntrance = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.5, ease: motionEase.enter } },
} as const;

export const buttonPressClass = "active:scale-[0.97] active:duration-100";

export const popoverPrimitiveMotionClass =
  "motion-duration-fast motion-state-ease data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0";
