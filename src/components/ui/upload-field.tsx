// ── UploadField ──────────────────────────────────────────────────────────────
// The Form System's file-picking surface (see DESIGN_SYSTEM → Form System).
// Extracted from EventForm's poster dropzone during the Backline port, because
// both forms needed the same three not-obvious details and only one of them had
// all three:
//
//   • The input is `sr-only`, NOT `hidden`. `display:none` removes it from the tab
//     order, which made the poster field unreachable by keyboard.
//   • `e.target.value` is cleared after every pick, so choosing the SAME file twice
//     in a row still fires `change`. Without it, rejecting a file and re-picking it
//     after fixing nothing looks like a dead control.
//   • Naming concrete MIME types in `accept` (not `image/*`) makes iOS hand back a
//     JPEG instead of a HEIC the browser cannot decode.
//
// ── ONE FIXED HEIGHT, both states ────────────────────────────────────────────
// The box is the same height empty and filled. That is the point: the old poster
// field was a short `py-8` dropzone that became a 16rem preview, so adding or
// removing a poster resized the form under the user's thumb — the exact thing the
// Form System exists to prevent. Callers set the height once via `className`.
//
// `fit` replaces what PLANS called `crop?: 1 | false` — the caller isn't choosing
// a crop, it is choosing how the preview is framed. Posters are square by the time
// they arrive, so they fill the box (`cover`); backline gear photos and rate cards
// arrive at whatever aspect the admin uploaded and must not be silently trimmed
// (`contain`).
import * as React from "react";
import { FileText, Upload } from "lucide-react";

import { useFieldAria } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";

export interface UploadFilled {
  /** Preview URL. Omit for a file with no visual preview (a PDF). */
  src?: string | null;
  /** Filename — the caption for a non-visual file, and the image's alt text. */
  name?: string | null;
}

interface Props {
  /** The input's id; also what a caller's own `<label htmlFor>` must point at. */
  id: string;
  /** Concrete MIME list, e.g. "image/jpeg,image/png". Never "image/*" — see above. */
  accept: string;
  /** Receives the picked file. Validate (and reject) in here. */
  onPick: (file: File) => void | Promise<void>;
  /** Empty-state call to action. */
  prompt: React.ReactNode;
  /** Present → the box shows the file instead of the dropzone. */
  filled?: UploadFilled | null;
  /** How a preview image is framed inside the fixed box. */
  fit?: "cover" | "contain";
  /** Renders a "Replace" trigger in the action rail when filled. */
  replaceLabel?: string;
  /** Extra action buttons for the filled state (Adjust, Remove …). */
  actions?: React.ReactNode;
  /** Height + any other box styling. The height must be fixed, not a `min-h-*`. */
  className?: string;
  invalid?: boolean;
  describedBy?: string;
}

const actionClass =
  "btn-interactive grid h-8 place-items-center rounded-full border border-border bg-card/90 px-3 text-xs font-semibold text-foreground shadow-sm focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] active:scale-[0.97] active:duration-tap";

// forwardRef so a form can address this field like any other control — the shared
// invalid-field focus (DESIGN_SYSTEM -> Form System -> Failure behaviour) needs a
// node to scroll to and focus. The ref lands on the file input, which is `sr-only`
// but deliberately still in the tab order, so focusing it is meaningful.
export const UploadField = React.forwardRef<HTMLInputElement, Props>(function UploadField({
  id,
  accept,
  onPick,
  prompt,
  filled,
  fit = "cover",
  replaceLabel,
  actions,
  className,
  invalid,
  describedBy,
}: Props, ref) {
  // An enclosing FormField publishes its error id; the explicit prop still wins.
  const field = useFieldAria();
  const describedByResolved = describedBy ?? field?.errorId ?? undefined;
  const invalidResolved = invalid || !!field?.errorId;
  const input = (
    <input
      id={id}
      ref={ref}
      type="file"
      accept={accept}
      className="sr-only"
      aria-invalid={invalidResolved || undefined}
      aria-describedby={describedByResolved}
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Reset BEFORE awaiting: `onPick` may reject the file, and the user's next
        // move is usually to pick the very same one again after checking it.
        event.target.value = "";
        if (file) void onPick(file);
      }}
    />
  );

  if (!filled) {
    return (
      // Deliberately NO `htmlFor` — this label WRAPS the input, which is already the
      // association. Doing both makes some browsers dispatch two activations, i.e.
      // the file picker opening twice off one tap. The filled state's Replace label
      // is a sibling of the input, so that one does need `htmlFor`.
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.2rem] bg-card/70 text-center shadow-sm transition-[background-color,box-shadow] duration-fast",
          "hover:bg-card hover:shadow-md focus-within:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] dark:hover:bg-secondary",
          invalidResolved && "ring-1 ring-destructive",
          className,
        )}
      >
        <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
        <span className="px-4 text-xs text-muted-foreground">{prompt}</span>
        {input}
      </label>
    );
  }

  return (
    // `focus-within` is load-bearing, not decoration: the input stays mounted here
    // (that is what lets Replace re-open the picker), and it is `sr-only`, so a
    // keyboard user tabbing onto it would otherwise get NO visible focus at all.
    // The empty state gets this from its own <label>.
    <div
      className={cn(
        "relative overflow-hidden rounded-[1.2rem] shadow-md focus-within:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]",
        invalidResolved && "ring-1 ring-destructive",
        className,
      )}
    >
      {filled.src ? (
        <img
          src={filled.src}
          alt={filled.name || ""}
          decoding="async"
          className={cn(
            "h-full w-full",
            fit === "cover" ? "object-cover" : "bg-foreground/[0.05] object-contain",
          )}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-foreground/[0.05] px-4 text-center">
          <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="line-clamp-2 break-all text-xs font-medium text-foreground/80">
            {filled.name}
          </span>
        </div>
      )}
      <div className="absolute right-2 top-2 flex gap-2">
        {replaceLabel ? (
          <label htmlFor={id} className={cn(actionClass, "cursor-pointer")}>
            {replaceLabel}
          </label>
        ) : null}
        {actions}
      </div>
      {input}
    </div>
  );
});
