// ── Resize ───────────────────────────────────────────────────────────────────
// THE height-glide primitive (Phase M2.5 — the "resize style" restored). A box
// whose height genuinely animates: 0 → natural on show, natural → 0 on hide
// (delayed unmount), and old → new when `dep` changes (a declared content swap,
// e.g. a keyed step/view/mode switch inside).
//
// AT REST THE BOX IS height:auto. That is the load-bearing design decision:
// a nested <Resize> (a picker inside a form panel) glides its own height and
// the change flows straight through an auto-height ancestor — no observer
// re-gliding it, no nested-glider fight, no per-frame tracking. Pixel heights
// exist ONLY while this box's own glide is in flight (auto→px pins don't
// animate — `auto` isn't interpolable — so pinning is instant and only the
// px→px leg glides).
//
// Division of labour (the no-conflicting-paths rule):
//   • <Resize> owns HEIGHT. One writer per box; nesting is safe because rest
//     state is auto.
//   • Content inside may crossfade (keyed motion.div, opacity only) — the pair
//     reads as one gesture.
//   • <Collapse> owns expand-from-nothing (0 ↔ content); see ui/collapse.tsx.
//
// Rule #1 intact (per-frame values never pass through React state): the glide
// is a CSS `transition: height` — the browser interpolates; React only sets
// discrete endpoints. The ResizeObserver here writes a REF only (the at-rest
// height, read as the FROM value on a dep change — by the time the dep effect
// runs, the DOM already holds the NEW content) and never re-renders anything.
//
// data-resizing is set while a height transition is actually running (driven by
// the browser's transitionrun/end/cancel), letting the dialog surface drop its
// blurred shadow mid-glide (globals.css).
import * as React from "react";

import { centerInDialogScroller } from "@/lib/animate-scroll";
import { resizeTransition } from "@/lib/motion";

const HEIGHT_TRANSITION = `height ${resizeTransition.duration}s cubic-bezier(${resizeTransition.ease.join(", ")})`;
// Fallback so a glide can never wedge (transitionend lost to display:none or an
// interrupted paint): slightly past the duration.
const SETTLE_FALLBACK_MS = resizeTransition.duration * 1000 + 80;

interface ResizeProps {
  show: boolean;
  /**
   * Pan the surrounding dialog scroller so the content lands in view when it
   * morphs — for a swap the user just triggered (switching to the tall
   * pick-dates calendar), so they always see what they're now editing. The pan
   * runs on the same duration+curve as the glide, so they read as one gesture.
   * No-op outside a scroll container.
   */
  scrollIntoView?: boolean;
  /**
   * Pass false to skip the closing glide and unmount immediately. Used for the
   * picker-registry handoff: the incoming picker's centring pan measures layout
   * right away, and an outgoing panel still collapsing would skew the target.
   */
  exit?: boolean;
  /**
   * Glide old → new height when this value changes while open — the declared
   * "content swap" signal (step key, view kind, mode toggle, month anchor).
   * Undeclared content changes (typing reveals an error row, a nested picker
   * glides) flow through the at-rest auto height instantly/naturally.
   */
  dep?: unknown;
  /** Applied to the inner content wrapper (use padding for gaps, not margin —
   * child margins aren't reliably part of the measured height). */
  className?: string;
  children: React.ReactNode;
}

export const Resize = React.forwardRef<HTMLDivElement, ResizeProps>(
  ({ show, exit = true, dep, scrollIntoView, className, children }, ref) => {
    const [present, setPresent] = React.useState(show);
    // undefined = auto (at rest). Px only while a glide is in flight.
    const [height, setHeight] = React.useState<number | undefined>(show ? undefined : 0);

    const outerRef = React.useRef<HTMLDivElement | null>(null);
    const innerRef = React.useRef<HTMLDivElement | null>(null);
    const observerRef = React.useRef<ResizeObserver | null>(null);
    // Last known content height, ref-only (see header). No state, no renders.
    const lastHeightRef = React.useRef<number | null>(null);
    // Skip the very first glide when the component mounts already-open — the
    // surrounding dialog/page entrance owns that moment.
    const firstMountOpen = React.useRef(show);
    const prevDepRef = React.useRef(dep);
    // False until a frame after mount. A dep change before that is
    // INITIALISATION, not a user-driven swap — a dialog's open-effect seeding
    // its fields (e.g. edit mode flipping `useDuration` one tick after mount)
    // would otherwise glide from a not-yet-settled measurement and read as a
    // sizing glitch on open. See the dep effect.
    const mountSettledRef = React.useRef(false);
    React.useEffect(() => {
      const raf = requestAnimationFrame(() => {
        mountSettledRef.current = true;
      });
      return () => cancelAnimationFrame(raf);
    }, []);

    const measureRef = React.useCallback((node: HTMLDivElement | null) => {
      innerRef.current = node;
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      lastHeightRef.current = node.scrollHeight;
      const observer = new ResizeObserver(() => {
        lastHeightRef.current = node.scrollHeight;
      });
      observer.observe(node);
      observerRef.current = observer;
    }, []);

    // data-resizing while a height transition is actually running — event-driven,
    // so it covers the open, close AND dep glides with one mechanism.
    React.useEffect(() => {
      const node = outerRef.current;
      if (!node) return;
      const flag = (event: TransitionEvent, on: boolean) => {
        if (event.target !== node || event.propertyName !== "height") return;
        if (on) node.setAttribute("data-resizing", "");
        else node.removeAttribute("data-resizing");
      };
      const onRun = (event: TransitionEvent) => flag(event, true);
      const onSettle = (event: TransitionEvent) => flag(event, false);
      node.addEventListener("transitionrun", onRun);
      node.addEventListener("transitionend", onSettle);
      node.addEventListener("transitioncancel", onSettle);
      return () => {
        node.removeEventListener("transitionrun", onRun);
        node.removeEventListener("transitionend", onSettle);
        node.removeEventListener("transitioncancel", onSettle);
      };
    }, [present]);

    // Glide the box height FROM → TO via the CSS transition, RELIABLY: pin FROM
    // imperatively + force a reflow so it's a painted baseline, THEN hand TO to
    // React (a bare rAF races React's commit and the box snaps to TO with no
    // transition — the close-from-auto bug). onSettle fires once, on
    // transitionend or the fallback timer. Returns an effect-cleanup.
    const glideHeight = React.useCallback((from: number, to: number, onSettle: () => void) => {
      const outer = outerRef.current;
      if (!outer) {
        onSettle();
        return () => {};
      }
      outer.style.height = `${from}px`;
      void outer.offsetHeight; // force layout at FROM so the transition has a baseline
      setHeight(to);
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        onSettle();
      };
      const onEnd = (event: TransitionEvent) => {
        if (event.target === outer && event.propertyName === "height") settle();
      };
      outer.addEventListener("transitionend", onEnd);
      const timer = window.setTimeout(settle, SETTLE_FALLBACK_MS);
      return () => {
        outer.removeEventListener("transitionend", onEnd);
        window.clearTimeout(timer);
      };
    }, []);

    // Mount on show; on hide, glide natural → 0 and unmount when it lands.
    React.useEffect(() => {
      if (show) {
        setPresent(true);
        return;
      }
      const inner = innerRef.current;
      if (!outerRef.current || !inner || !exit) {
        setPresent(false);
        return;
      }
      return glideHeight(inner.scrollHeight, 0, () => setPresent(false));
    }, [show, exit, glideHeight]);

    // Open glide: 0 → natural, then release to auto so nested glides flow free.
    React.useLayoutEffect(() => {
      if (!present || !show) return;
      const inner = innerRef.current;
      if (!inner) return;
      if (firstMountOpen.current) {
        firstMountOpen.current = false;
        setHeight(undefined); // mounted already-open: straight to auto, no glide
        return;
      }
      return glideHeight(0, inner.scrollHeight, () => setHeight(undefined));
    }, [present, show, glideHeight]);

    // Dep glide: old → new height around a declared content swap. Runs after the
    // swap committed — the DOM holds NEW content, lastHeightRef still holds OLD.
    React.useLayoutEffect(() => {
      if (prevDepRef.current === dep) return;
      prevDepRef.current = dep;
      // Initialisation, not a swap — adopt the new dep silently (see mountSettledRef).
      if (!mountSettledRef.current) return;
      if (!show || !present) return;
      const inner = innerRef.current;
      if (!inner) return;
      const from = lastHeightRef.current;
      const to = inner.scrollHeight;
      if (from == null || Math.abs(from - to) < 1) return;
      if (scrollIntoView) centerInDialogScroller(inner);
      return glideHeight(from, to, () => setHeight(undefined));
    }, [dep, show, present, scrollIntoView, glideHeight]);

    if (!show && !present) return null;

    return (
      <div
        ref={(node) => {
          outerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        // Clip ONLY while a glide is in flight. `height` is undefined (auto) at
        // rest and a pixel value only mid-glide, so it is exactly the right
        // condition — no extra state, no CSS hook.
        //
        // Permanent clipping was wrong once FLIP arrived (Phase N): a picker's
        // panel is position:absolute and its spacer collapses INSTANTLY on close,
        // so this box shrinks instantly too — and a permanently-clipping ancestor
        // would cut the still-animating panel dead instead of letting it slide
        // out. At rest there is nothing to clip anyway (the box is its content's
        // natural height).
        style={{ height, overflow: height === undefined ? "visible" : "hidden", transition: HEIGHT_TRANSITION }}
      >
        <div ref={measureRef} className={className}>
          {children}
        </div>
      </div>
    );
  },
);
Resize.displayName = "Resize";
