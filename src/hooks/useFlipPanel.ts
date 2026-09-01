// ── useFlipPanel ─────────────────────────────────────────────────────────────
// The inline-panel recipe on top of <FlipScope> (Phase N). Both booking pickers
// (DateField's calendar, TimeSelect's wheel) and the form's collapsible sections
// want the identical behaviour, so it lives here once.
//
// The shape it expects — see DateField for a worked example:
//
//   <div ref={rootRef}>                      ← the FLIP anchor
//     <div className="relative">
//       <button …/>                          ← trigger; NEVER moves
//       {mounted && (
//         <div className="absolute inset-x-0 top-full overflow-hidden">
//           <div ref={contentRef}> …panel… </div>
//         </div>
//       )}
//     </div>
//     <div ref={spacerRef} />                 ← THE layout change, 0 ↔ H, instant
//   </div>
//
// Why a spacer and an absolutely-positioned panel, rather than the panel simply
// being in flow: out of flow, the panel's mount/unmount perturbs NO layout, so a
// delayed unmount is safe and the closing tween has something real to animate.
// Every earlier attempt had the panel in flow, which made its unmount *itself*
// the layout change — that is what forced the exit-cancelling, the pan-chasing
// and the registry's `exit={false}` handoff.
//
// Height is never animated. The spacer snaps 0 ↔ H; <FlipScope> turns the
// resulting displacement of everything else into compositor transforms, and the
// panel content rides the same clock (−H → 0 opening, 0 → −H closing) so it fills
// exactly the space the siblings vacate. They tile; nothing overlaps.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useFlip, type FlipCommit } from "@/components/ui/flip-scope";

export interface FlipPanel {
  /** True while the panel should be in the DOM — outlives `open` by one tween. */
  mounted: boolean;
  /** The FLIP anchor: wraps trigger + spacer. */
  rootRef: React.MutableRefObject<HTMLDivElement | null>;
  /** The panel's content box, inside the absolute clipping wrapper. */
  contentRef: React.MutableRefObject<HTMLDivElement | null>;
  /**
   * The absolute wrapper. Clipped ONLY while a run is in flight — at rest the
   * content sits at translateY(0) inside a box of exactly its own height, so
   * there is nothing to clip anyway. This matters for NESTING: a picker opening
   * inside an already-expanded panel would otherwise have its own absolute panel
   * cut off by the outer panel's permanently-clipping wrapper.
   */
  clipRef: React.MutableRefObject<HTMLDivElement | null>;
  /** The empty div whose height IS the layout change. */
  spacerRef: React.MutableRefObject<HTMLDivElement | null>;
  /**
   * Re-fit after the panel's own content changes size while open (a calendar
   * swapping a 5-week month for a 6-week one). Same FLIP, no special case.
   */
  remeasure: () => void;
}

export function useFlipPanel(open: boolean): FlipPanel {
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const clipRef = useRef<HTMLDivElement | null>(null);
  const flip = useFlip();

  // Scroll the open-pan consumed, replayed negated on close so the two are exact
  // mirrors rather than two independently-tuned movements.
  const panDeltaRef = useRef(0);
  // Height currently reflected in the spacer — the FROM value for a remeasure.
  const heightRef = useRef(0);
  // Clip while moving, release at rest (see clipRef).
  const clip = (on: boolean) => {
    if (clipRef.current) clipRef.current.style.overflow = on ? "hidden" : "visible";
  };

  // Read inside the settle callback, which fires after the tween: `open` may have
  // flipped back by then (reopened mid-close).
  const openRef = useRef(open);
  openRef.current = open;

  // Mount so the opening FLIP has something to measure.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // A dialog seeding its fields on open looks identical to a user action. Skip
  // the first pass — initialisation must not animate. (Phase M's <Resize> needed
  // the same guard; it is easy to forget and reads as a sizing glitch on open.)
  const initialisedRef = useRef(false);

  useLayoutEffect(() => {
    if (!initialisedRef.current) {
      initialisedRef.current = true;
      return;
    }
    const root = rootRef.current;
    const spacer = spacerRef.current;
    const content = contentRef.current;
    if (!root || !spacer) return;

    if (open) {
      if (!content) return;
      const h = content.offsetHeight;
      heightRef.current = h;
      clip(true);
      const apply = (): FlipCommit => {
        spacer.style.height = `${h}px`;
        return {
          companions: [{ el: content, fromY: -h }],
          // N8 — pan + expand as ONE gesture (owner: "feel like a single: pan and
          // expand"). `panInto` pans the scroller by the MINIMUM needed to fit the
          // opening panel (only if it would fall below the fold), and FlipScope
          // folds that scroll into the SAME compositor tween as the reveal + the
          // sibling yield — one clock, off the main thread, smooth even in LPM.
          // The returned delta is recorded (panDeltaRef) and reversed exactly on
          // close, so collapse + pan-back is the mirror gesture. A pan does move
          // content above the field too (accepted N8 trade — like a native picker
          // sheet shifting to fit); it is NOT the old laggy scrollTop tween.
          panInto: content,
          onSettle: () => clip(false),
        };
      };
      panDeltaRef.current = flip ? flip.run(root, apply) : (apply(), 0);
      return;
    }

    if (!mounted) return;
    const h = heightRef.current;
    clip(true);
    const apply = (): FlipCommit => {
      spacer.style.height = "";
      return {
        companions: content ? [{ el: content, fromY: 0, toY: -h }] : [],
        scrollBy: -panDeltaRef.current,
        // Unmount on the SAME settle that ends the tween — not a parallel timer
        // of equal duration, which raced it and flashed the panel back into view
        // for a frame or two after closing. Guarded on openRef because a
        // cancelled run also settles: reopening mid-close must not unmount.
        onSettle: () => {
          if (!openRef.current) setMounted(false);
        },
      };
    };
    if (flip) flip.run(root, apply);
    else apply();
    panDeltaRef.current = 0;
    heightRef.current = 0;
  }, [open, mounted, flip]);

  const remeasure = useCallback(() => {
    if (!openRef.current) return;
    const root = rootRef.current;
    const spacer = spacerRef.current;
    const content = contentRef.current;
    if (!root || !spacer || !content) return;
    const h = content.offsetHeight;
    if (Math.abs(h - heightRef.current) < 1) return;
    heightRef.current = h;
    clip(true);
    const apply = (): FlipCommit => {
      spacer.style.height = `${h}px`;
      return { onSettle: () => clip(false) };
    };
    if (flip) flip.run(root, apply);
    else apply();
  }, [flip]);

  return { mounted, rootRef, contentRef, clipRef, spacerRef, remeasure };
}
