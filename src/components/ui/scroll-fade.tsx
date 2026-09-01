// ── Dialog scroll progress (imperative) ──────────────────────────────────────
// The thin bar that tracks how far a dialog body is scrolled, shared by
// dialog.tsx and alert-dialog.tsx (which had drifted apart — the alert copy
// still transitioned `transform`, the exact scaleX lag the dialog version's
// comment warns against).
//
// Phase M rule: per-frame values never pass through React state. The old
// version routed progress through context state (two setStates per scroll
// tick), which re-rendered the dialog chrome on EVERY scroll frame — and on
// every content-resize frame, because the ResizeObserver here watches the
// scroll body's children. Now the writer paints progress straight onto the
// bar node — a CSS variable for the scaleX plus a data-scrollable flag for
// the fade — rAF-throttled. The context value is a stable ref object, so
// React renders nothing at all while scrolling or resizing.
import * as React from "react";

import { cn } from "@/lib/utils";

/** Fraction of the bar always shown once a body is scrollable (the 0% stub). */
const MIN_VISIBLE = 0.06;

export type ScrollFadeHandles = {
  /** The progress-bar node; the scroll body writes styles straight onto it. */
  bar: React.MutableRefObject<HTMLDivElement | null>;
};

/** One stable handle object per dialog — its identity never changes, so the
 * context that shares it between body (writer) and header (bar) never
 * re-renders a consumer. */
export const useScrollFadeHandles = (): ScrollFadeHandles => {
  const bar = React.useRef<HTMLDivElement | null>(null);
  return React.useMemo(() => ({ bar }), []);
};

/**
 * Watch a scroll container and mirror its progress onto the bar node.
 * Observes the container AND its children: when the dialog sits at max
 * height, the container's own box stops changing while its content still
 * grows, so a node-only observer would go stale. Both signals are cheap now —
 * the callback is a style write, not a render.
 */
export const useScrollFadeWriter = (
  scrollRef: React.RefObject<HTMLDivElement | null>,
  handles: ScrollFadeHandles | null,
  /**
   * Re-attach when this changes. Needed by hosts whose scroll node mounts LATER
   * than the hook (a dialog body only exists while open) or whose children are
   * swapped wholesale (a step crossfade) — the observer watches the children, and
   * a fixed-height sheet's own box never resizes to trigger a resync.
   */
  resyncKey?: string | null,
) => {
  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node || !handles) return;
    let frame: number | null = null;

    const apply = () => {
      frame = null;
      const bar = handles.bar.current;
      if (!bar) return;
      const maxScroll = node.scrollHeight - node.clientHeight;
      const progress = maxScroll > 0 ? Math.min(1, Math.max(0, node.scrollTop / maxScroll)) : 0;
      // Keep a visible stub at 0%: a bar that starts at zero width reads as "no bar"
      // rather than "nothing scrolled yet". Mapped into [MIN_VISIBLE, 1] so the top
      // still shows a nub and the bottom is still exactly full.
      bar.style.setProperty("--scroll-progress", String(MIN_VISIBLE + (1 - MIN_VISIBLE) * progress));
      bar.dataset.scrollable = maxScroll > 2 ? "true" : "false";
    };
    const schedule = () => {
      if (frame == null) frame = window.requestAnimationFrame(apply);
    };

    apply();
    node.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    Array.from(node.children).forEach((child) => observer.observe(child));
    return () => {
      node.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [handles, scrollRef, resyncKey]);
};

/**
 * The bar itself. Only the opacity fades — the scaleX tracks scroll position
 * directly via the CSS variable (no transform transition), otherwise the bar
 * visibly lags/jitters behind each scroll tick trying to animate to the new
 * width. Position (top/bottom) comes from the caller's className.
 */
export const ScrollFadeBar = ({
  handles,
  className,
}: {
  handles: ScrollFadeHandles | null;
  className?: string;
}) => (
  <div
    ref={(node) => {
      if (handles) handles.bar.current = node;
    }}
    aria-hidden="true"
    className={cn(
      "pointer-events-none absolute inset-x-0 z-10 h-[2px] origin-left bg-primary/40 opacity-0 transition-opacity duration-fast data-[scrollable=true]:opacity-100",
      className,
    )}
    style={{ transform: "scaleX(var(--scroll-progress, 0))" }}
  />
);
