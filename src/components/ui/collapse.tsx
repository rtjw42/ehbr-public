// ── Collapse ─────────────────────────────────────────────────────────────────
// Lightweight expand/collapse-FROM-NOTHING (Phase M2.5). Pure CSS
// `grid-template-rows: 0fr ↔ 1fr` — the modern idiom: no height measurement, no
// ResizeObserver, no `auto↔px` juggling. Both 0fr and 1fr are concrete,
// interpolable values, so the paint-race that plagues `height:auto` animation
// simply cannot happen here — open AND close animate reliably, every time.
//
// This is the primitive for a box that opens from nothing: pickers (wheel,
// calendar), inline panels, collapsibles. It is NOT for morphs between two
// non-zero heights (dialog step swaps, view swaps) — those need real
// measurement and use <Resize>. A <Resize> may nest INSIDE a <Collapse>: the
// 1fr row just fits the inner glide frame by frame, so a mode-swap inside an
// expanded panel morphs smoothly.
//
// Content stays mounted through the closing transition, then unmounts — so a
// panel that inits on open (a wheel centring + grabbing focus) still fires its
// mount effects exactly when it opens, and its collapse still animates.
//
// Rule #1 intact: React only flips a boolean (0fr/1fr); the browser interpolates.
// data-resizing is set while the rows transition runs (browser transition
// events), so an ancestor dialog can drop its blurred shadow mid-expand
// (globals.css) — shared with <Resize>.
import * as React from "react";

import { centerInDialogScroller } from "@/lib/animate-scroll";
import { resizeTransition } from "@/lib/motion";

const ROWS_TRANSITION = `grid-template-rows ${resizeTransition.duration}s cubic-bezier(${resizeTransition.ease.join(", ")})`;
// Fallback so the node can never linger mounted if transitionend is lost.
const SETTLE_FALLBACK_MS = resizeTransition.duration * 1000 + 80;

interface CollapseProps {
  show: boolean;
  /**
   * Pass false to collapse instantly (no transition, immediate unmount). Used
   * for the picker-registry handoff: the incoming picker's centring pan needs a
   * settled layout, which a still-collapsing panel would skew.
   */
  exit?: boolean;
  /**
   * Pan the surrounding dialog scroller so the panel lands in view as it
   * expands — the user always sees what they just opened. The pan runs on the
   * same duration+curve as the expand, so they read as one gesture. Measures
   * the content's FINAL height (scrollHeight reports it even while the row is
   * still collapsed), so the target is right from frame one. No-op outside a
   * scroll container.
   */
  scrollIntoView?: boolean;
  /** Applied to the inner (clipping) wrapper — put the panel's outer gap/padding
   * here so it animates in with the expand. */
  className?: string;
  children: React.ReactNode;
}

export const Collapse = React.forwardRef<HTMLDivElement, CollapseProps>(
  ({ show, exit = true, scrollIntoView, className, children }, ref) => {
    const [present, setPresent] = React.useState(show);
    const [open, setOpen] = React.useState(show); // drives 0fr / 1fr
    const outerRef = React.useRef<HTMLDivElement | null>(null);
    const innerRef = React.useRef<HTMLDivElement | null>(null);

    const setRef = (node: HTMLDivElement | null) => {
      outerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };

    // data-resizing while the rows transition runs → dialog shadow-drop hook.
    React.useEffect(() => {
      const node = outerRef.current;
      if (!node) return;
      const flag = (event: TransitionEvent, on: boolean) => {
        if (event.target !== node || event.propertyName !== "grid-template-rows") return;
        node.toggleAttribute("data-resizing", on);
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

    // Show → mount (the open glide fires from the layout effect below). Hide →
    // collapse then unmount (or instant when exit is false).
    React.useEffect(() => {
      if (show) {
        setPresent(true);
        return;
      }
      if (!exit) {
        setOpen(false);
        setPresent(false);
        return;
      }
      setOpen(false);
      const outer = outerRef.current;
      if (!outer) {
        setPresent(false);
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setPresent(false);
      };
      const onEnd = (event: TransitionEvent) => {
        if (event.target === outer && event.propertyName === "grid-template-rows") finish();
      };
      outer.addEventListener("transitionend", onEnd);
      const timer = window.setTimeout(finish, SETTLE_FALLBACK_MS);
      return () => {
        outer.removeEventListener("transitionend", onEnd);
        window.clearTimeout(timer);
      };
    }, [show, exit]);

    // Open glide: once mounted at 0fr, force a reflow so the 0fr baseline is
    // real, THEN flip to 1fr — the transition needs a painted value to run from
    // (a bare rAF races React's commit and the expand snaps).
    React.useLayoutEffect(() => {
      if (!present || !show || open) return;
      const node = outerRef.current;
      if (!node) return;
      void node.offsetHeight; // force layout at 0fr
      setOpen(true);
      // Start the pan with the expand so they land together (one gesture).
      if (scrollIntoView) centerInDialogScroller(innerRef.current);
    }, [present, show, open, scrollIntoView]);

    if (!show && !present) return null;

    return (
      <div
        ref={setRef}
        style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: ROWS_TRANSITION }}
      >
        <div ref={innerRef} className={className} style={{ overflow: "hidden", minHeight: 0 }}>
          {children}
        </div>
      </div>
    );
  },
);
Collapse.displayName = "Collapse";
