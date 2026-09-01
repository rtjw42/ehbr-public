// ── FieldRow ─────────────────────────────────────────────────────────────────
// The Form System's picker affordance: a row showing a field's CURRENT value that
// pushes a full-frame picker screen when tapped (see DESIGN_SYSTEM → Form System).
// Replaces the old inline-expanding panel — nothing expands in place any more, so
// there is no layout push, no pan, and no sub-pixel text blur.
import * as React from "react";
import { ChevronRight } from "lucide-react";

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
  /** Renders the value muted (e.g. a placeholder like "Select a date"). */
  placeholder?: boolean;
  className?: string;
}

export const FieldRow = React.forwardRef<HTMLButtonElement, Props>(
  ({ id, label, value, onClick, icon, ariaLabel, invalid, placeholder, className }, ref) => (
    <button
      id={id}
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-haspopup="dialog"
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-foreground transition-[border-color,box-shadow] [-webkit-tap-highlight-color:transparent]",
        "focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]",
        "aria-[invalid=true]:border-destructive",
        "hover:border-foreground/40 active:scale-[0.99] active:duration-tap",
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
  ),
);
FieldRow.displayName = "FieldRow";

export default FieldRow;
