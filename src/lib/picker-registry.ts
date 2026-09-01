// ── Inline-picker registry ───────────────────────────────────────────────────
// The booking form's date and time pickers close only on their Done button (never on
// an outside tap), so nothing dismisses one when another opens. This tiny module keeps
// a single "currently open" picker: opening any picker closes whichever was open, so at
// most one inline panel is expanded at a time and they can't stack and shove the form.
//
// Deliberately outside React (a module singleton): the pickers are separate component
// instances with no common ancestor to thread state through, and only ever one form is
// mounted. A stray tap in empty space still closes nothing — only opening another picker
// (an intentional switch) dismisses the previous one.
let closeCurrent: (() => void) | null = null;

/** Register `close` as the open picker, closing any previously open one first. */
export function openPicker(close: () => void) {
  if (closeCurrent && closeCurrent !== close) closeCurrent();
  closeCurrent = close;
}

/** Deregister `close` (on the picker's own close/unmount) if it's the current one. */
export function releasePicker(close: () => void) {
  if (closeCurrent === close) closeCurrent = null;
}
