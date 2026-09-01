import { useState } from "react";

/**
 * The app's motion tiers — one authority for the mobile/desktop motion split,
 * replacing the scattered width cutoffs (640 in JS; 639/767/(pointer:coarse) in
 * CSS). Tier keys off POINTER, not width: layout breakpoints stay width-based
 * and unchanged. Resolved once and written to data-motion on <html> (pre-paint,
 * by public/theme-init.js) so CSS ([data-motion="…"]) and JS read the SAME call.
 *   lite — coarse pointer (phones/tablets; performance tier)
 *   full — fine pointer (desktop)
 *
 * Binary by design: there is no `reduced` tier. Motion is ONE system with no
 * degraded modes — every animation is compositor-cheap (transform/opacity) and
 * frame-rate-independent, so it stays smooth everywhere without a stripped tier.
 * (iOS Low Power Mode — the case that mattered — does not set
 * prefers-reduced-motion anyway, so a reduced tier never helped it.)
 */
export type MotionTier = "full" | "lite";

const MOTION_TIERS = ["full", "lite"] as const;

/**
 * Resolve the tier from media queries. Mirrors public/theme-init.js — keep the
 * two in sync. SSR-safe (defaults to the richest tier with no window).
 */
export const resolveMotionTier = (): MotionTier => {
  if (typeof window === "undefined") return "full";
  if (window.matchMedia("(pointer: coarse)").matches) return "lite";
  return "full";
};

/**
 * Read the tier theme-init.js wrote pre-paint, so JS and CSS never diverge.
 * Falls back to resolving directly when the attribute is absent (tests, or any
 * environment where the pre-paint script didn't run). Non-hook, so module-level
 * code (e.g. motion.ts) can read the same authority outside of React.
 */
export const getMotionTier = (): MotionTier => {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.motion;
    if (attr && (MOTION_TIERS as readonly string[]).includes(attr)) {
      return attr as MotionTier;
    }
  }
  return resolveMotionTier();
};

/**
 * The motion tier for the current session, resolved once at mount. Fixed for
 * the session — the app doesn't reflow between pointer types mid-session, and
 * entrance/cascade motion is a mount-time decision — so this intentionally does
 * not react to later media-query changes (mirrors the old mount-time gating).
 */
export const useMotionTier = (): MotionTier => useState(getMotionTier)[0];
