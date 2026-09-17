// ── FieldRow ─────────────────────────────────────────────────────────────────
// The Form System's `›` trigger: label + a field's CURRENT value. Opens a
// PickerDropdown for bounded content or pushes a screen for unbounded content
// (DESIGN_SYSTEM → Form System). Nothing expands in place, so opening one never
// moves the layout.
import * as React from "react";
import { ChevronRight } from "lucide-react";

import { useFieldAria } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";

interface Props {
  id?: string;
  /** Visible label on the left (omit when a <Label> above already names it). */
  label?: React.ReactNode;
  /** The current value, shown emphasised on the right. */
  value: React.ReactNode;
  onClick: () => void;
  icon?: React.ReactNode;
  ariaLabel?: string;
  invalid?: boolean;
  /**
   * Greys the row out and stops it opening. Kept RENDERED rather than removed by
   * the caller: a trigger that vanishes at its own limit (ContactsForm's Add row at
   * five links) is a layout change, which is the one thing this system does not do.
   */
  disabled?: boolean;
  /** Renders the value muted (e.g. a placeholder like "Select a date"). */
  placeholder?: boolean;
  /**
   * Takes FormShell's screen autofocus (`[data-form-autofocus]`) instead of the
   * screen's first control. For a pushed list screen whose first control is a
   * text input: focusing that would summon the keyboard mid-crossfade, and a
   * row is a button, so it does not.
   */
  autofocus?: boolean;
  className?: string;
}

export const FieldRow = React.forwardRef<HTMLButtonElement, Props>(
  ({ id, label, value, onClick, icon, ariaLabel, invalid, disabled, placeholder, autofocus, className }, ref) => {
  // An enclosing FormField publishes its error id. Until this existed a picker row
  // could not reference its own error message at all, which is why every unwired
  // field in the app was a FieldRow.
  const field = useFieldAria();
  return (
    <button
      id={id}
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={field?.errorId ?? undefined}
      aria-invalid={invalid || (field?.errorId ? true : undefined)}
      aria-haspopup="dialog"
      data-form-autofocus={autofocus ? "" : undefined}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-foreground transition-[border-color,box-shadow,opacity] [-webkit-tap-highlight-color:transparent]",
        "focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]",
        "aria-[invalid=true]:border-destructive",
        "hover:border-foreground/40 active:scale-[0.99] active:duration-tap",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input disabled:active:scale-100",
        className,
      )}
    >
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      {label ? <span className="shrink-0 text-muted-foreground">{label}</span> : null}
      {/* Value reads from the LEFT, so a picker row lines up with the text inputs
          above it rather than hugging the right edge — the whole form scans down a
          single left margin. The chevron takes the `ml-auto` instead. */}
      <span
        className={cn(
          "min-w-0 truncate text-left",
          placeholder ? "text-muted-foreground" : "font-semibold tabular-nums",
        )}
      >
        {value}
      </span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
  },
);
FieldRow.displayName = "FieldRow";
