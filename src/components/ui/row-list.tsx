// ── Row list ─────────────────────────────────────────────────────────────────
// The Form System's list-of-rows shape: a flat stack of editable rows, each ONE
// control with something before it and actions after it, plus the one behaviour
// every list needs and gets wrong differently — a freshly added row is scrolled
// into view and focused. Extracted once two shapes existed (DESIGN_SYSTEM.md →
// Form System): ContactsForm's icon-in-input + remove, and MediaSetlistForm's
// number + input + `›` + remove. Both are `<Row>` with different slots.
//
// Rows NEVER animate on add or remove. That would be a height animation inside a
// form body, which this system does not do — the new row simply appears, and the
// scroll + focus is what tells the user where it went (it is also where they have
// to type next).
//
// Errors are deliberately NOT here. A list with one list-level message (contacts:
// "save at least one link") wraps the whole list in a `FormField`; a list whose
// rows fail individually (media URLs) wraps each `<Row>` in its own. The row does
// not know which, so it owns layout and focus and nothing else.
import * as React from "react";
import { ChevronRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A client-only stable key for a row. Keying by array index re-binds input state
 * to the wrong row when a middle row is removed; a uid also serves as the row's
 * focus key and, where rows fail individually, its error key.
 */
export const newRowUid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `row-${Math.random().toString(36).slice(2)}`;

type Pending =
  | { uid: string; mode: "focus" }
  | { uid: string; mode: "reveal"; block: ScrollLogicalPosition };

/**
 * Where a row goes after a commit. `setRowRef(uid)` goes on each row's control;
 * the add handler calls `focusRowOnCommit(uid)` and the row is scrolled to and
 * focused once it has actually rendered. `revealRowOnCommit(uid, block)` only
 * scrolls, instantly — for a list that has just been RE-SHOWN with its scroll
 * position gone (the body scroller clamps to 0 while a shorter pushed screen is
 * up), so Back from a row's own screen lands on that row rather than the top.
 * Instant because the list is still at opacity 0 when this runs, and a focus
 * would summon the keyboard on a screen the user only came back to.
 *
 * A layout effect with no dependency list on purpose: it runs before paint after
 * every commit and is a ref check when nothing is pending, so it cannot miss the
 * commit that mounts the row whatever state that commit was caused by, and a
 * reveal is never seen happening.
 */
export function useRowFocus() {
  const rowRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const pending = React.useRef<Pending | null>(null);

  const setRowRef = React.useCallback(
    (uid: string) => (node: HTMLElement | null) => {
      rowRefs.current[uid] = node;
    },
    [],
  );

  const focusRowOnCommit = React.useCallback((uid: string) => {
    pending.current = { uid, mode: "focus" };
  }, []);

  const revealRowOnCommit = React.useCallback((uid: string, block: ScrollLogicalPosition = "center") => {
    pending.current = { uid, mode: "reveal", block };
  }, []);

  React.useLayoutEffect(() => {
    const next = pending.current;
    if (!next) return;
    const node = rowRefs.current[next.uid];
    if (!node) return;
    pending.current = null;
    if (next.mode === "reveal") {
      node.scrollIntoView({ block: next.block, behavior: "instant" });
      return;
    }
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // preventScroll so the focus does not fight the smooth scroll with a jump of
    // the browser's own — the same reason useInvalidFieldFocus does it.
    node.focus({ preventScroll: true });
  });

  return { setRowRef, focusRowOnCommit, revealRowOnCommit };
}

interface RowProps {
  /** Before the control: a row number, or nothing when the control carries its own icon. */
  leading?: React.ReactNode;
  /** The control (one input, or a small stack of them for a sub-record). */
  children: React.ReactNode;
  /** After the control: `RowOpenButton` / `RowRemoveButton`. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * One row. Aligned to the TOP so a row whose control is a stack (an album's
 * name + URL) keeps its actions level with the first input, and an error line
 * beneath the control never pushes the actions down.
 */
export function Row({ leading, children, actions, className }: RowProps) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      {leading ? (
        <span className="flex h-10 w-6 shrink-0 items-center text-xs font-semibold tabular-nums text-muted-foreground">
          {leading}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {/* 44px hit boxes centred on the 40px input: the 2px overhang is pulled back
          with negative margins so the row's rhythm stays the input's height. */}
      {actions ? <div className="-my-0.5 flex shrink-0 items-center">{actions}</div> : null}
    </div>
  );
}

/**
 * An input that carries an icon inside its left edge — the icon IS the row's
 * visible label, so the input's accessible name has to say it in words. The
 * padding is applied from here so a caller cannot pair the icon with an input
 * that types underneath it.
 */
export function RowIconInput({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative [&>input]:pl-9">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  );
}

interface RowActionProps {
  onClick: () => void;
  /** Accessible name — every row's action reads the same, so say which row. */
  label: string;
  disabled?: boolean;
}

/** `›` — the row opens a pushed screen of its own (a sub-record with more fields). */
export function RowOpenButton({ onClick, label, disabled }: RowActionProps) {
  return (
    <Button type="button" size="icon" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label} className="h-11 w-11 shrink-0">
      <ChevronRight className="h-4 w-4" />
    </Button>
  );
}

export function RowRemoveButton({ onClick, label, disabled }: RowActionProps) {
  return (
    <Button type="button" size="icon" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label} className="h-11 w-11 shrink-0">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}
