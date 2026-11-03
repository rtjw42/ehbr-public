// ── useInvalidFieldFocus ─────────────────────────────────────────────────────
// One answer to "what happens when a form refuses to save", shared by every form
// (see DESIGN_SYSTEM.md → Form System). The form scrolls to the first invalid
// field and puts the cursor in it, so a refused save always ends with the problem
// on screen and focused — never a button that appears to do nothing.
// MediaSetlistForm pushes the screen the bad field lives on first, then calls
// this once that screen has committed.
//
// The scroll container is found from the field itself (`[data-form-body]`, which
// FormShell marks and PickerDropdown already measures against) rather than passed
// in — one less thing for each form to wire, and impossible to wire wrongly.
import { useCallback, useRef } from "react";

// Leaves the field clear of the header rather than flush against it.
const SCROLL_MARGIN = 24;

// The scroll is a native smooth scroll, so focus has to wait for it — focusing
// mid-scroll makes the browser jump to its own idea of where the field should be
// and fights the animation. 160ms is the settle time BookingForm arrived at.
const FOCUS_AFTER_SCROLL_MS = 160;

export function useInvalidFieldFocus<Key extends string>() {
  const fieldRefs = useRef<Partial<Record<Key, HTMLElement | null>>>({});

  /** `ref={setFieldRef("title")}` on the control (or its trigger, for a picker). */
  const setFieldRef = useCallback(
    (key: Key) => (node: HTMLElement | null) => {
      fieldRefs.current[key] = node;
    },
    [],
  );

  /**
   * Scroll to the first invalid field in `order` and focus it.
   *
   * `order` is the form's VISUAL top-down order, which is not the order the
   * validator happens to fill the object in — "first invalid" must mean the
   * topmost one on screen, or the form scrolls past an error to reach a later one.
   *
   * `behavior` defaults to smooth — the movement is the cue that says "here" on a
   * screen the user is already looking at. A form that has just PUSHED the
   * screen the field lives on passes `"instant"` and calls this from a layout
   * effect: the screen is still at opacity 0, so the scroll is invisible, and a
   * smooth one would have run underneath the crossfade instead.
   */
  const focusFirstInvalidField = useCallback(
    (
      errors: Partial<Record<Key, string | undefined>>,
      order: readonly Key[],
      { behavior = "smooth" }: { behavior?: ScrollBehavior } = {},
    ) => {
      const firstInvalidKey = order.find((key) => errors[key]);
      if (!firstInvalidKey) return;
      const target = fieldRefs.current[firstInvalidKey];
      if (!target) return;
      const container = target.closest<HTMLElement>("[data-form-body]");
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const desiredTop = Math.max(
        0,
        container.scrollTop + targetRect.top - containerRect.top - SCROLL_MARGIN,
      );
      container.scrollTo({ top: desiredTop, behavior });

      window.setTimeout(() => {
        try {
          target.focus({ preventScroll: true });
        } catch {
          target.focus();
        }
      }, FOCUS_AFTER_SCROLL_MS);
    },
    [],
  );

  return { setFieldRef, focusFirstInvalidField };
}
