// ── PickerDropdown ───────────────────────────────────────────────────────────
// The form's inline picker surface — the slide-down, done properly.
//
// ── What the old inline picker got wrong ─────────────────────────────────────
// It grew a SPACER (0→H, shoving every field below it down) and PANNED the
// scroller to fit. The pan is what dragged a field's own label out of view, and
// it only fired near the bottom, so some fields did it and some didn't.
//
// ── The model here ───────────────────────────────────────────────────────────
// 1. The panel OVERLAYS. No spacer, so opening changes no layout: nothing above
//    the trigger moves, and nothing for iOS Low Power to cap.
// 2. It ALWAYS opens downward. No flip-up — a panel that sometimes appears above
//    and sometimes below is disorienting, and upward panels cover the label.
// 3. To guarantee the whole panel fits, the form SCROLLS by the minimum needed —
//    and that scroll is hard-capped so the trigger's label can never reach the top
//    edge. So the field you're editing and its label are always on screen; only
//    the content below moves. This is the "pan" done right: minimal, one
//    direction, and bounded by the thing the user must keep seeing.
// 4. CLOSING NEVER MOVES THE PAGE. The panel is out of flow, so it never changed
//    the page height to begin with; an earlier version borrowed temporary bottom
//    padding to guarantee scroll room and *that* release was the jump. Instead the
//    form body carries a small permanent bottom spacer (FormShell) — nothing to
//    add, nothing to release, nothing to clamp.
// 5. IT CAN NEVER BE CUT OFF. The panel's max height is ALWAYS clamped to the room
//    actually visible below the trigger, and it re-fits whenever its own content
//    changes height. That last part matters more than it sounds: the multi-date
//    grid is lazy-loaded, so a first open measures the Suspense fallback rather
//    than the real calendar, and navigating months swaps a 5-week grid for a
//    6-week one. Both used to leave the panel overflowing the body's bottom edge.
//
// Motion is the panel's own clipped slide + fade — transform/opacity only, so text
// never sits mid-translate and never resamples.
import * as React from "react";

import { motionDurations, motionEase } from "@/lib/motion";
import { cn } from "@/lib/utils";

const GAP = 8; // breathing room between trigger and panel, and against the body edge
// Room kept above the trigger so its <Label> stays on screen while the panel is
// open. The scroll is capped at this — the label is the thing that must not vanish.
const LABEL_ALLOWANCE = 30;
// Deliberate breathing room kept beneath an open panel, so it reads as placed
// rather than jammed against the bottom edge.
const BELOW_MARGIN = 16;
// Slower than a plain crossfade: the panel travels its own height, and a gentler
// glide reads as considered rather than snapped. Transform/opacity only, so the
// extra time costs nothing on low-power devices.
const DURATION = motionDurations.slow;
// Every timer below is DERIVED from DURATION so they can't drift apart when the
// duration is tuned.
const TRANSITION_MS = DURATION * 1000;
const SETTLE_MS = TRANSITION_MS + 40;
// Re-clamp once the smooth scroll has landed; browsers take a little longer than
// the panel's own glide, so give it a margin over the transition.
const SCROLL_SETTLE_MS = TRANSITION_MS + 120;
const TRANSITION = [
  `transform ${DURATION}s cubic-bezier(${motionEase.enter.join(",")})`,
  `opacity ${DURATION}s cubic-bezier(${motionEase.enter.join(",")})`,
].join(", ");

interface Props {
  open: boolean;
  onClose: () => void;
  /** The element the panel hangs off — used to measure available room. */
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** Accessible label for the panel. */
  ariaLabel?: string;
  className?: string;
}

export function PickerDropdown({ open, onClose, anchorRef, children, ariaLabel, className }: Props) {
  const [mounted, setMounted] = React.useState(false);
  const [shown, setShown] = React.useState(false); // drives the slide/fade
  const [maxHeight, setMaxHeight] = React.useState<number | undefined>(undefined);
  const [clipping, setClipping] = React.useState(true);
  // `will-change` is a PROMOTION HINT, not a style: left on, mobile Safari keeps
  // the compositor layer alive and they accumulate across a session. flip-scope.tsx
  // learned this the hard way and strips it on settle — same rule here. On only
  // while the slide is actually running.
  const [hinting, setHinting] = React.useState(true);

  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  // The content box INSIDE the panel. Measured instead of the panel itself: the
  // panel's height is clamped, so once capped it stops changing and would hide any
  // further content growth from the observer.
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const closeTimer = React.useRef<number | null>(null);
  // Exactly ONE scroll per open. Without this the ResizeObserver's initial fire
  // (it fires synchronously on observe) issued a second scroll off an already-
  // moving scrollTop, so the form travelled about twice as far as needed.
  const didScrollRef = React.useRef(false);
  const settleTimer = React.useRef<number | null>(null);
  // True while a smooth scroll is in flight. Clamp-only calls must not run then:
  // they'd measure the field's PRE-scroll position and shrink the panel to the
  // room that exists right now rather than the room it is scrolling into. The
  // ResizeObserver fires synchronously on observe(), so this fired every open and
  // made the picker render short until the settle pass corrected it.
  const scrollPendingRef = React.useRef(false);

  // Mount while opening; unmount one transition after closing.
  React.useEffect(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    setShown(false);
    setClipping(true);
    setHinting(true);
    closeTimer.current = window.setTimeout(() => setMounted(false), SETTLE_MS);
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, [open, mounted]);

  // Fit the panel into the room actually visible below the trigger.
  //
  // `allowScroll` is honoured at most once per open (see didScrollRef): the form
  // scrolls by the minimum needed, capped BOTH by the label staying on screen and
  // by how far the container can actually scroll. Every later call only re-clamps.
  const fit = React.useCallback((allowScroll: boolean) => {
    if (!allowScroll && scrollPendingRef.current) return;
    const anchor = anchorRef.current;
    const content = contentRef.current;
    if (!anchor || !content) return;
    const scroller = anchor.closest<HTMLElement>("[data-form-body]");
    if (!scroller) return;

    const panel = panelRef.current;
    if (!panel) return;

    const bounds = scroller.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();

    // The panel is border-box, so the max-height we set below covers its padding
    // and border too — while `content` measures only what's INSIDE them. Comparing
    // the two directly sized every panel ~18px short of its own content, which is
    // why pickers scrolled internally even with room to spare. Measure the chrome
    // and reason in whole-panel heights throughout.
    const style = getComputedStyle(panel);
    const chrome =
      Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom) +
      Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.borderBottomWidth);
    const panelHeight = content.offsetHeight + chrome;

    // How far the panel would poke past the bottom of the form body, keeping
    // BELOW_MARGIN of deliberate space beneath it.
    const overflow = rect.bottom + GAP + panelHeight + BELOW_MARGIN - bounds.bottom;
    // How far we may scroll before the trigger's label would hit the top edge.
    const headroom = Math.max(0, rect.top - bounds.top - LABEL_ALLOWANCE);
    // ...and how far the container can ACTUALLY scroll. Sizing the panel for a
    // scroll that never happens is what left it cut off by the bottom edge.
    const scrollable = Math.max(0, scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop);
    const scrollBy =
      allowScroll && !didScrollRef.current ? Math.max(0, Math.min(overflow, headroom, scrollable)) : 0;

    if (scrollBy > 0) {
      didScrollRef.current = true;
      scrollPendingRef.current = true;
      scroller.scrollTo({ top: scroller.scrollTop + scrollBy, behavior: "smooth" });
      // `available` below is a PREDICTION of where the field lands. Re-clamp once
      // the smooth scroll has actually settled, against real geometry.
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        scrollPendingRef.current = false;
        fitRef.current?.(false);
      }, SCROLL_SETTLE_MS);
    }

    // Clamp to the room that will exist once that scroll lands. Deliberately NOT
    // floored at some minimum: a floor larger than the real room would push the
    // panel past the body edge — the exact clipping this clamp exists to prevent.
    const available = bounds.bottom - (rect.bottom - scrollBy) - GAP - BELOW_MARGIN;
    setMaxHeight(Math.max(0, Math.floor(available)));
  }, [anchorRef]);

  // Lets the settle timer call the latest `fit` without making it a dependency.
  const fitRef = React.useRef<((allowScroll: boolean) => void) | null>(null);
  fitRef.current = fit;

  // Initial fit, before paint so nothing flashes in the wrong place.
  React.useLayoutEffect(() => {
    if (!mounted || !open) {
      didScrollRef.current = false;
      scrollPendingRef.current = false;
      return;
    }
    fit(true);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [mounted, open, fit]);

  // Re-clamp when the content's own height changes — a lazily-loaded grid, or
  // chips. Clamp ONLY: scrolling from here is what double-scrolled the form.
  React.useEffect(() => {
    if (!mounted || !open) return;
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => fit(false));
    observer.observe(content);
    return () => observer.disconnect();
  }, [mounted, open, fit]);

  // Re-clamp when the KEYBOARD translates the sheet under us. FormShell publishes
  // its shift on the body; without this the panel keeps a max-height measured
  // against a position the sheet has already left (focus Notes → tap a picker →
  // the keyboard dismisses while we measure). Attribute-based so the shell and the
  // dropdown stay decoupled.
  React.useEffect(() => {
    if (!mounted || !open) return;
    const scroller = anchorRef.current?.closest<HTMLElement>("[data-form-body]");
    if (!scroller) return;
    const observer = new MutationObserver(() => fit(false));
    observer.observe(scroller, { attributes: true, attributeFilter: ["data-kb-shift"] });
    return () => observer.disconnect();
  }, [mounted, open, fit, anchorRef]);

  React.useEffect(() => () => {
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
  }, []);

  // Release the clip once the panel is at rest so its shadow isn't cut off (and a
  // nested overlay isn't trapped). Clipped again on close by the effect above.
  React.useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => {
      setClipping(false);
      setHinting(false); // drop the compositor-layer hint; the slide is over
    }, SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [shown]);

  // Outside pointer / Escape dismiss. Safe here (unlike the old inline panel):
  // values commit live as you pick or spin, so dismissing never discards an edit.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const wrapper = wrapperRef.current;
      const anchor = anchorRef.current;
      const target = event.target as Node;
      if (wrapper?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Stop the surrounding dialog from closing too — Escape belongs to the picker
      // while one is open.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, anchorRef]);

  if (!mounted) return null;

  return (
    <div
      ref={wrapperRef}
      className={cn("absolute inset-x-0 top-full z-30 pt-2", clipping && "overflow-hidden")}
    >
      <div
        style={{
          transform: `translate3d(0, ${shown ? "0" : "-100%"}, 0)`,
          opacity: shown ? 1 : 0,
          transition: TRANSITION,
          willChange: hinting ? "transform, opacity" : undefined,
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal={false}
          aria-label={ariaLabel}
          // `!== undefined`, NOT a truthiness test: `fit` floors at 0, and a field
          // with no room below it produced maxHeight === 0 — falsy, so the clamp
          // was dropped entirely and the panel rendered at full height, spilling
          // past the body's bottom edge. Exactly the clipping this clamp prevents.
          style={maxHeight !== undefined ? { maxHeight, overflowY: "auto" } : undefined}
          data-picker-panel=""
          className={cn(
            "overscroll-contain rounded-lg border border-border bg-card p-2 shadow-lg dark:shadow-none",
            // Matches the form body: scrollable, but no native scrollbar track.
            "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            className,
          )}
        >
          <div ref={contentRef}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export default PickerDropdown;
