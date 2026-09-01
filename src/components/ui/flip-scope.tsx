// ── FlipScope ────────────────────────────────────────────────────────────────
// THE geometry authority for a scrollable surface (Phase N). Nothing else in the
// scope may write a transform or touch scrollTop.
//
// The doctrine, restated from Phase M and this time applied without exception:
//
//   Layout commits ONCE, INSTANTLY. Motion is ONLY transform/opacity.
//   Per-frame values never pass through React state.
//
// Phase M's step-0 test proved a pure-CSS `transition: height` still stutters in
// iOS Low Power: the cap is on per-frame main-thread work, not the rAF
// scheduler, so EVERY height glide is capped whoever drives it. M2.5/M2.6 then
// revived exactly that (`transition: height`, `transition: grid-template-rows` —
// both layout). This module is the escalation M2's Q16 fenced off "unless the
// exit/swap polish doesn't satisfy", sibling compensation included.
//
// FLIP = First, Layout, Invert, Play:
//   1. First  — record getBoundingClientRect() of the affected set.
//   2. Layout — apply the real geometry change. Instant, no transition.
//   3. Invert — measure again; translateY(first − last), transitions OFF.
//   4. Play   — next frame, transition transforms to 0; strip them on settle.
//
// getBoundingClientRect() INCLUDES in-flight transforms, so step 1 reads where
// things visually are right now. Interruption, reversal and picker handoff are
// therefore correct by construction — this is what lets `exit={false}`,
// `withExit` and the return-pan all be deleted rather than coordinated.
//
// ── The scroll (the part that kept failing) ──────────────────────────────────
// Every prior approach failed structurally, not from tuning: native smooth
// scroll clamps its target at CALL time (stops short while a panel is still
// expanding); a framer scrollTop tween is rAF-driven and LPM-capped by
// definition; the return-pan raced the browser's own clamp. All three assumed
// the scroll range was still moving.
//
// Here it isn't. Layout is committed in step 2, so by step 3 scrollHeight is
// final — nothing to chase, nothing to clamp against. And the pan is applied to
// scrollTop INSTANTLY, before `last` is measured. Because rects are
// viewport-relative, the deliberate pan AND the browser's involuntary clamp on
// shrink both surface as position deltas and get animated away by the same
// transforms. The clamp jerk isn't fixed so much as made invisible, absorbed
// into the one gesture — and the pan rides the compositor with everything else,
// so it is frame-rate independent like the rest.
//
// ── Why the affected set is a partition ──────────────────────────────────────
// Walking anchor → scope root and taking ALL siblings at each level yields a set
// that is DISJOINT (no member is an ancestor of another) and COMPLETE (every
// element is either the anchor or a sibling at some level). Disjoint matters:
// nested transforms compose, so an ancestor and its descendant both animating
// would double-count the delta. Complete matters: elements ABOVE the anchor still
// need to move when a pan happens, and they fall out with dy = scroll delta.
//
// One uniform mechanism, no layering. Push and scroll are the same number.
import * as React from "react";

import { flipTransition } from "@/lib/motion";

const TRANSITION = `transform ${flipTransition.duration}s cubic-bezier(${flipTransition.ease.join(", ")})`;
// Primary settle is a timer, not transitionend: transitionend is lost under
// display:none, parent unmount and interrupted paints (Phase M learned this the
// hard way). transitionend still fires the same idempotent settle when it works.
const SETTLE_MS = flipTransition.duration * 1000 + 60;
// Sub-pixel deltas aren't worth a compositor layer.
const MIN_DELTA = 0.5;
// Breathing room when panning something into view.
const PAN_MARGIN = 12;

/** What `applyLayout` may hand back to be tweened on the same clock. */
export interface FlipCommit {
  /**
   * Elements that should tween from an explicit translateY to 0 alongside the
   * push — the picker panel's clipped reveal. They are NOT part of the measured
   * set (they may not have existed before the layout change), so their offset is
   * given directly.
   *
   * A panel whose content starts at -H composes correctly with its own ancestor's
   * FLIP transform: the ancestor carries the scroll delta, the content carries
   * -H, and the siblings' dy is (scrollDelta − H). Same total, so content fills
   * exactly the space the siblings vacate — they tile with no overlap.
   */
  companions?: Array<{ el: HTMLElement | null; fromY: number; toY?: number }>;
  /** Pan this into view if it would fall below the fold. Minimum movement only. */
  panInto?: HTMLElement | null;
  /** Explicit scroll delta (used to reverse a recorded open-pan exactly). */
  scrollBy?: number;
  /**
   * Fired once when the run settles (or is cancelled by a newer run). THE hook
   * for delayed unmount — chain it here rather than running a parallel timer of
   * the same nominal duration, or the two race and the caller can unmount a frame
   * after the transform is reset, flashing the content back into view.
   */
  onSettle?: () => void;
}

export interface FlipApi {
  /**
   * Run one FLIP around a geometry change.
   *
   * `applyLayout` must make the change synchronously with direct style writes —
   * NOT React state, which wouldn't have committed by the time we measure. It
   * may return a FlipCommit.
   *
   * Returns the scroll delta actually applied, so the caller can reverse it.
   */
  run: (anchor: HTMLElement | null, applyLayout: () => FlipCommit | void) => number;
  /** The scroll container, for callers that need to reason about the fold. */
  getScroller: () => HTMLElement | null;
}

const FlipContext = React.createContext<FlipApi | null>(null);

/** Elements opting out (sticky/fixed chrome would tear if translated). */
const isIgnored = (el: Element): boolean =>
  !(el instanceof HTMLElement) || el.hasAttribute("data-flip-ignore");

/**
 * Anchor + all siblings at every level up to the root. Disjoint and complete —
 * see the header. Deliberately NOT `nextElementSibling`: in a grid or flex-row
 * the next sibling can share the anchor's row (the booking form's date field and
 * start-time sit side by side on desktop), and pushing it would be wrong. Every
 * member gets its own measured dy, so same-row members simply resolve to 0.
 */
const collectSet = (anchor: HTMLElement, root: HTMLElement): HTMLElement[] => {
  const set: HTMLElement[] = [anchor];
  let node: HTMLElement = anchor;
  while (node !== root && node.parentElement) {
    const parent = node.parentElement;
    for (const child of parent.children) {
      if (child !== node && !isIgnored(child)) set.push(child as HTMLElement);
    }
    if (parent === root) break;
    node = parent;
  }
  return set;
};

const clearTransform = (el: HTMLElement) => {
  el.style.transition = "";
  el.style.transform = "";
  el.style.willChange = "";
};

export const FlipScope = ({
  scrollerRef,
  children,
}: {
  scrollerRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // The single in-flight run. A new run cancels it (see step 2 in `run`).
  const activeRef = React.useRef<{ els: HTMLElement[]; cancel: () => void } | null>(null);

  // Strip everything on unmount so a closing dialog can't leave transforms on
  // recycled nodes.
  React.useEffect(() => () => activeRef.current?.cancel(), []);

  const run = React.useCallback<FlipApi["run"]>((anchor, applyLayout) => {
    const root = rootRef.current;
    if (!anchor || !root || !root.contains(anchor)) {
      applyLayout();
      return 0;
    }

    const scroller = scrollerRef.current ?? null;
    const set = collectSet(anchor, root);

    // ── 1. First ── measured WITH in-flight transforms, so an interrupted run
    // continues from where the eye currently is rather than snapping.
    const first = new Map<HTMLElement, number>();
    for (const el of set) first.set(el, el.getBoundingClientRect().top);
    const prevScrollTop = scroller?.scrollTop ?? 0;

    // ── 2. Cancel + Layout ── clear transforms (including any from elements no
    // longer in the set) so `last` measures true resting geometry.
    activeRef.current?.cancel();
    for (const el of set) clearTransform(el);

    const commit = applyLayout() ?? {};

    // ── 3. Pan ── instant. The range is already final, so this can't clamp short.
    let scrollDelta = 0;
    if (scroller) {
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      let desired = scroller.scrollTop;
      if (typeof commit.scrollBy === "number") {
        desired = scroller.scrollTop + commit.scrollBy;
      } else if (commit.panInto) {
        const rect = commit.panInto.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        // Minimum movement only: nudge just enough to clear the fold, and never
        // past the panel's own top (keeping the field + everything above it moving
        // with the page rather than pinning the section header to the top).
        const overflowBottom = rect.bottom + PAN_MARGIN - view.bottom;
        if (overflowBottom > 0) {
          const headroom = rect.top - view.top - PAN_MARGIN;
          desired = scroller.scrollTop + Math.max(0, Math.min(overflowBottom, headroom));
        }
      }
      const clamped = Math.max(0, Math.min(desired, maxScroll));
      if (Math.abs(clamped - scroller.scrollTop) >= MIN_DELTA) scroller.scrollTop = clamped;
      // The BROWSER may also have clamped scrollTop during the layout step (a
      // shrink under the user). Measuring the delta against the pre-layout value
      // folds that involuntary movement into the same tween — this is the fix for
      // the "shoots back up / positions don't remount" complaint.
      scrollDelta = scroller.scrollTop - prevScrollTop;
    }

    // ── 4. Invert ── transitions off, so nothing animates into the start state.
    const moved: HTMLElement[] = [];
    for (const el of set) {
      const dy = (first.get(el) ?? 0) - el.getBoundingClientRect().top;
      if (Math.abs(dy) < MIN_DELTA) continue;
      el.style.transition = "none";
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
      el.style.willChange = "transform";
      moved.push(el);
    }
    // Companions carry their own target (the closing panel tweens 0 → −H, the
    // opening one −H → 0), so `moved` alone isn't enough to drive the play step.
    const targets = new Map<HTMLElement, number>();
    for (const el of moved) targets.set(el, 0);
    for (const c of commit.companions ?? []) {
      if (!c.el) continue;
      c.el.style.transition = "none";
      c.el.style.transform = `translate3d(0, ${c.fromY}px, 0)`;
      c.el.style.willChange = "transform";
      moved.push(c.el);
      targets.set(c.el, c.toY ?? 0);
    }
    if (!moved.length) {
      // Nothing to animate, but the caller still needs its completion signal.
      commit.onSettle?.();
      return scrollDelta;
    }

    // A painted baseline is mandatory: a bare rAF races React's commit and the
    // box snaps to the end state with no transition (Phase M2.6's close bug).
    void root.offsetHeight;

    // ── 5. Play ──
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      root.removeEventListener("transitionend", onEnd);
      // will-change removed here, always: left on, it accumulates compositor
      // layers across a session on mobile Safari. Transform removed too, so
      // nothing sits transformed at rest (sub-pixel text blur, surprise
      // containing blocks).
      //
      // EXCEPT for a companion parked at a non-zero target — a closing panel
      // sitting at translateY(-H). Clearing that would snap it back to 0, i.e.
      // fully visible, for however many frames pass before the caller unmounts
      // it. That is a real flash, not a rendering artifact. Keep the transform,
      // drop only the transition and the layer hint.
      for (const el of moved) {
        if (targets.get(el)) {
          el.style.transition = "";
          el.style.willChange = "";
        } else {
          clearTransform(el);
        }
      }
      if (activeRef.current?.cancel === settle) activeRef.current = null;
      commit.onSettle?.();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName === "transform" && moved.includes(event.target as HTMLElement)) settle();
    };
    const timer = window.setTimeout(settle, SETTLE_MS);
    root.addEventListener("transitionend", onEnd);
    activeRef.current = { els: moved, cancel: settle };

    for (const el of moved) {
      el.style.transition = TRANSITION;
      el.style.transform = `translate3d(0, ${targets.get(el) ?? 0}px, 0)`;
    }

    return scrollDelta;
  }, [scrollerRef]);

  const api = React.useMemo<FlipApi>(
    () => ({ run, getScroller: () => scrollerRef.current ?? null }),
    [run, scrollerRef],
  );

  return (
    <FlipContext.Provider value={api}>
      <div ref={rootRef}>{children}</div>
    </FlipContext.Provider>
  );
};

/**
 * Null outside a scope — callers fall back to an instant layout change, so a
 * picker still works if it's ever rendered outside the booking dialog.
 */
export const useFlip = (): FlipApi | null => React.useContext(FlipContext);
