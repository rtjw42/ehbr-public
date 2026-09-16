// ── FormField ────────────────────────────────────────────────────────────────
// The Form System's field wrapper: label row (with an optional character counter
// on the right), the control, and the error line beneath it.
//
// This exists because the same three-part stack was hand-written in every form,
// and had drifted — `space-y-1.5` in some places and a bare `<div>` in others,
// `mt-1` on some error lines and not others, and `aria-describedby` wired on some
// fields but not all.
//
// ── The association is published, not requested ───────────────────────────────
// Deriving the error id from the field id guarantees the id EXISTS; it does not
// guarantee any control points at it, and that distinction cost us: callers wired
// `aria-describedby` by hand and forgot. EventForm — written onto this primitive —
// wired 3 of 5, BookingForm 1 of 10, and `FieldRow` had no prop for it at all, so
// every picker field in the app was unwireable however carefully it was written.
//
// So FormField publishes the error id through context and the controls
// (`Input`, `Textarea`, `FieldRow`, `UploadField`) read it themselves. A field with
// an `error` is now associated by construction, and a caller cannot forget.
//
// Why context rather than cloning the child: a picker field's child is a
// positioning `<div>` wrapping the `FieldRow` AND its `PickerDropdown`, so a clone
// would land on the wrapper and describe nothing. Context reaches the control
// wherever it sits. An explicit `aria-describedby` on a control still wins, and
// nothing inside a `PickerDropdown` is a form control, so the panel's own contents
// never pick this up by accident.
import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const fieldErrorId = (id: string) => `${id}-error`;

interface FieldContext {
  /** The error element's id while an error is showing, else null. */
  errorId: string | null;
}

const FormFieldContext = React.createContext<FieldContext | null>(null);

/**
 * For form controls: the association published by an enclosing FormField.
 * Returns null outside one, so a control used on a page is unaffected.
 */
export const useFieldAria = () => React.useContext(FormFieldContext);

interface Props {
  /** Must match the control's `id` — the label's `htmlFor` and the error id derive from it. */
  id: string;
  label: React.ReactNode;
  /** Rendered small and muted at the right of the label row (e.g. a char counter). */
  labelTrailing?: React.ReactNode;
  /**
   * Keeps the label for assistive tech but does not draw the label row. For a
   * list row whose control already carries its label visibly — the network icon
   * inside a contact input, the video icon inside a media URL — a text label above
   * it would be a second tier saying the same thing. The error line still renders
   * beneath the control, which is the whole reason such a row is a FormField.
   */
  labelHidden?: boolean;
  error?: string;
  /** The control. It picks up `aria-describedby` / `aria-invalid` from context. */
  children: React.ReactNode;
  className?: string;
}

export function FormField({ id, label, labelTrailing, labelHidden, error, children, className }: Props) {
  const errorId = error ? fieldErrorId(id) : null;
  // Memoized so a control consuming the context does not re-render on every parent
  // render just because the object identity changed.
  const ctx = React.useMemo<FieldContext>(() => ({ errorId }), [errorId]);

  return (
    <FormFieldContext.Provider value={ctx}>
      <div className={cn("space-y-1.5", className)}>
        {labelHidden ? null : (
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={id}>{label}</Label>
            {labelTrailing ? (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{labelTrailing}</span>
            ) : null}
          </div>
        )}
        {children}
        {error ? (
          <p id={fieldErrorId(id)} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {/* A hidden label sits LAST: `space-y` margins every child after the
            first, so an sr-only label in first position would push the control
            down by the label gap and out of line with the row's actions. DOM
            order is irrelevant to the `for` association. */}
        {labelHidden ? <Label htmlFor={id} className="sr-only">{label}</Label> : null}
      </div>
    </FormFieldContext.Provider>
  );
}
