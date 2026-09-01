// ── Dialog scroll animator ────────────────────────────────────────────────────
// The ONE way a dialog's scroll position is animated (Phase M rule: one writer
// per scroller). Used by <Collapse>/<Resize>'s `scrollIntoView` (panning a panel
// into view as it expands/morphs — so the user always sees what they just
// opened), the pickers' return-pan on close, and BookingForm's
// scroll-to-invalid-field.
//
// A JS tween on the SAME duration + curve as the panel height glide
// (`resizeTransition` — <Resize> builds its CSS transition from the same
// token), so pan and glide cannot desync: they read as one gesture. Chosen
// over native `scrollTo({behavior:"smooth"})` deliberately (Phase M2.5): the
// UA owns native smooth's clock, which drifted against the glide, and it
// clamps its target at CALL time — while a panel is still expanding, the
// range needed by the target doesn't exist yet, so it stops short. Per-frame
// writes clamp per-frame instead: each write lands as far as the range allows
// and later writes push on as the range grows (or shrinks, on the return-pan).
//
// LPM note: rAF-driven, so iOS Low Power caps it to ~30fps — but a height
// glide is main-thread per-frame work under the same cap, so both degrade
// TOGETHER and stay locked. A compositor pan against a capped glide would
// desync; coherence wins.
//
// It always yields to the user: the first pointer/wheel/touch on the container
// cancels the tween instead of fighting the finger frame-by-frame.
import { animate } from "framer-motion";
import { resizeTransition } from "@/lib/motion";

/**
 * Tween `container.scrollTop` to `to` (clamped to ≥ 0; values past the current
 * max simply clamp per-frame, so a still-growing scroll range can't overshoot).
 * Returns a cancel function for callers that unmount mid-tween (safe to call
 * twice).
 */
function animateDialogScroll(container: HTMLElement, to: number): () => void {
  const from = container.scrollTop;
  const target = Math.max(0, to);
  if (Math.abs(target - from) < 1) return () => {};

  const controls = animate(from, target, {
    duration: resizeTransition.duration,
    ease: [...resizeTransition.ease],
    onUpdate: (value) => {
      container.scrollTop = value;
    },
  });

  const detach = () => {
    container.removeEventListener("pointerdown", cancel);
    container.removeEventListener("wheel", cancel);
    container.removeEventListener("touchstart", cancel);
  };
  const cancel = () => {
    detach();
    controls.stop();
  };
  container.addEventListener("pointerdown", cancel, { passive: true });
  container.addEventListener("wheel", cancel, { passive: true });
  container.addEventListener("touchstart", cancel, { passive: true });
  // Natural completion: just drop the listeners (nothing left to cancel).
  controls.then(detach, detach);
  return cancel;
}

/** Nearest ancestor that genuinely scrolls; skips overflow:hidden wrappers. */
const getScrollParent = (node: HTMLElement | null): HTMLElement | null => {
  let el = node?.parentElement ?? null;
  while (el) {
    const overflowY = window.getComputedStyle(el).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return el;
    el = el.parentElement;
  }
  return null;
};

/**
 * Smooth-pan the element's dialog scroller so the element sits centred (or
 * top-aligned when it's taller than the viewport).
 *
 * NOT the DOM's scrollIntoView: that scrolls EVERY scrollable ancestor
 * (including the page behind the dialog, and any programmatically-scrollable
 * overflow:hidden box on the way up) — we walk to the real scroller and move
 * only that.
 *
 * Sizes off the element's FINAL height (`scrollHeight` reports full content
 * height even while an ancestor clips it to zero), so it aims correctly from
 * frame one for a panel that is still expanding. The scroll range needed may
 * not exist yet mid-expand; the tween's per-frame writes clamp and push on as
 * the range grows, arriving together with the expand.
 *
 * Returns the pan's cancel function, or undefined when there's nothing to do.
 */
export function centerInDialogScroller(el: HTMLElement | null): (() => void) | undefined {
  const container = getScrollParent(el);
  if (!el || !container) return undefined;

  const rect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const top = container.scrollTop + (rect.top - containerRect.top);
  const finalHeight = Math.max(el.scrollHeight, rect.height);
  // An element taller than the viewport can't be centred without hiding its
  // top, so align it to the top instead; otherwise centre it.
  const target = finalHeight >= container.clientHeight
    ? top - 8
    : top - (container.clientHeight - finalHeight) / 2;

  return animateDialogScroll(container, target);
}
