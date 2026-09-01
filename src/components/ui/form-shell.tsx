// ── FormShell ────────────────────────────────────────────────────────────────
// The one container every form uses (see DESIGN_SYSTEM.md → Form System). A modal
// SHEET that on mobile is anchored BELOW the nav (never edge-to-edge) and stays
// above the keyboard; on desktop it's a centred, height-capped card.
//
// It renders a STACK of screens — one per STEP (form, review, verify), each a
// `FormScreen` { title, body, footer }. Pickers are NOT screens: they are inline
// overlay dropdowns (ui/picker-dropdown.tsx). The top of the stack is active; changing
// the active key **crossfades on opacity only** — no translate/scale, so text never
// resamples (the sub-pixel blur that read as non-premium is gone by construction).
// The frame is STABLE: content that overflows scrolls; the box does not glide height.
//
// Behaviour:
//   • Back/Escape POPS the active screen (calls its onBack) when the stack is deeper
//     than one — it never closes the whole form. At depth 1, Escape closes (unless
//     the screen is non-dismissable, e.g. Turnstile mid-verify).
//   • No outside-click close, ever (guards in-progress input).
//   • Built on Radix Dialog, so focus-trap, portal and aria come for free.
//
// Deliberately NOT here yet (follow-up, tracked in PLANS Current #2):
//   • dimming/inerting the nav while open (cross-component signal to SiteNav)
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { ChevronLeft, X } from "lucide-react";

import { crossfadeTransition } from "@/lib/motion";
import { useI18n } from "@/hooks/useI18n";
import { ScrollFadeBar, useScrollFadeHandles, useScrollFadeWriter } from "@/components/ui/scroll-fade";
import { cn } from "@/lib/utils";

export interface FormScreen {
  /** Stable identity. Changing the ACTIVE key triggers the crossfade. */
  key: string;
  /** Title only — no sub-description. "Add Booking" says enough, and a second
      line of prose competes with the fields for attention. */
  title: React.ReactNode;
  /** Scrolls within the stable frame when it overflows. */
  body: React.ReactNode;
  /** Pinned action row (raw nodes — full flexibility per screen). */
  footer?: React.ReactNode;
  /**
   * A persistent notice under the title, INSIDE the header chrome. Deliberately not
   * in the scroll body: a body-level banner reflows every field below it the moment
   * it appears (which happens live while dragging the duration slider), and a
   * floating one would cover content. In the chrome it does neither — the scroll
   * content never moves, only the visible window gets shorter.
   */
  banner?: React.ReactNode;
  /**
   * Escape / Back handler used when this screen sits ABOVE another in the stack.
   * Required for any screen you can push onto (pickers, review, verify) so Back
   * pops it. Omit on the root screen.
   */
  onBack?: () => void;
  /**
   * When false, Escape / close / back are all blocked (e.g. Turnstile once the
   * token is in hand and submitting). Default true.
   */
  dismissable?: boolean;
}

interface FormShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stack; the LAST entry is the active screen. Must be non-empty while open. */
  stack: FormScreen[];
  /** The scrolling body element — for consumers that pan to a field (validation). */
  bodyRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** Extra classes for the sheet surface (rare — most sizing lives here). */
  className?: string;
}

// ── Keyboard shift ────────────────────────────────────────────────────────────
// THE FORM NEVER RESIZES — not between screens, and not when the keyboard opens.
// A soft keyboard shrinks the visual viewport but not the layout viewport, so a
// fixed sheet would sit behind it. Rather than shrink the sheet (a resize), we
// TRANSLATE it up by the minimum needed to clear the keyboard, clamped to the
// headroom above it. Transform-only → compositor, LPM-safe, height untouched.
//
// Incremental + self-correcting: each measurement reads the CURRENT rect (which
// already includes the active shift), so repeated keyboard events converge rather
// than accumulate. Rule #1 compliant — one px value written on discrete viewport
// events, never per frame.
const KB_MARGIN = 8; // breathing room between the sheet and the keyboard
const MIN_TOP = 8; // never translate the sheet past the very top of the screen

function useKeyboardShift(active: boolean, elRef: React.RefObject<HTMLElement | null>): number {
  const [shift, setShift] = React.useState(0);
  const shiftRef = React.useRef(0);

  React.useEffect(() => {
    if (!active) {
      shiftRef.current = 0;
      setShift(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    // rAF-throttled: the keyboard animation fires resize/scroll many times, and
    // each raw call would be a setState. One measurement per frame, at most.
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const el = elRef.current;
      if (!el) return;
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const rect = el.getBoundingClientRect();
      const gapBelow = window.innerHeight - rect.bottom;
      // Further up we still need to go (negative → we can come back down).
      const need = keyboard > 0 ? keyboard - gapBelow + KB_MARGIN : -shiftRef.current;
      const headroom = Math.max(0, rect.top - MIN_TOP);
      const next = Math.max(0, Math.min(shiftRef.current + need, shiftRef.current + headroom));
      if (Math.abs(next - shiftRef.current) < 1) return;
      shiftRef.current = next;
      setShift(next);
    };
    const schedule = () => {
      if (frame == null) frame = window.requestAnimationFrame(update);
    };

    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (frame != null) window.cancelAnimationFrame(frame);
    };
  }, [active, elRef]);

  return active ? shift : 0;
}

export function FormShell({ open, onOpenChange, stack, bodyRef: externalBodyRef, className }: FormShellProps) {
  const { t } = useI18n();
  const active = stack[stack.length - 1];
  const depth = stack.length;
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  // The body node also lives in STATE, not just a ref: it only exists while the
  // dialog is open, so a plain ref left the scroll-progress writer running once at
  // FormShell mount (node still null) and never again — the bar never lit up.
  const [bodyNode, setBodyNode] = React.useState<HTMLDivElement | null>(null);
  const setBodyRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      bodyRef.current = node;
      setBodyNode(node);
      if (externalBodyRef) externalBodyRef.current = node;
    },
    [externalBodyRef],
  );
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const kbShift = useKeyboardShift(open, sheetRef);
  // Published on the body so an open PickerDropdown can re-measure when the
  // keyboard shifts the sheet under it — otherwise it sizes itself against a
  // position the sheet has already left (focus Notes → tap a picker → the
  // keyboard dismisses mid-measure).
  const kbShiftAttr = String(Math.round(kbShift));

  // Scroll progress is fully imperative — the writer paints straight onto the bar
  // node, so no scroll or resize tick ever re-renders the shell. The resync key
  // covers both moments a plain ref would miss: the body mounting (it exists only
  // while open) and a screen crossfade swapping the children the observer watches.
  const scrollHandles = useScrollFadeHandles();
  useScrollFadeWriter(bodyRef, scrollHandles, `${bodyNode ? 1 : 0}:${active?.key ?? ""}`);

  // First open renders at rest (the dialog entrance owns that moment); only
  // SUBSEQUENT screen changes crossfade. Mirrors BookingForm's swapFadeReadyRef.
  const fadeReadyRef = React.useRef(false);
  React.useEffect(() => {
    fadeReadyRef.current = open;
  }, [open]);

  // Move focus into each newly-activated screen: its first [data-form-autofocus],
  // else the first focusable control. preventScroll so it never fights the crossfade.
  const activeKey = active?.key;
  React.useEffect(() => {
    if (!open || !activeKey) return;
    const id = window.setTimeout(() => {
      const root = bodyRef.current;
      if (!root) return;
      const target =
        root.querySelector<HTMLElement>("[data-form-autofocus]") ??
        root.querySelector<HTMLElement>(
          'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
        );
      target?.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(id);
  }, [open, activeKey]);

  if (!active && open) {
    // A non-empty stack is required while open; fail loudly in dev rather than
    // render an empty sheet.
    if (import.meta.env.DEV) console.error("FormShell: `stack` is empty while open.");
  }

  const canDismiss = active?.dismissable !== false;

  const handleBack = () => {
    if (depth > 1) active?.onBack?.();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && canDismiss && onOpenChange(false)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm dark:bg-black/62",
            "motion-duration-base motion-state-ease data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          ref={sheetRef}
          data-form-shell=""
          // Screens carry a title only. Radix's documented opt-out for the missing
          // Description dev warning.
          aria-describedby={undefined}
          // ── Sheet geometry — ONE stable size, never resized ──
          // Mobile: top-anchored below the nav, capped at 30rem so it reads as a card
          // with room beneath (not a full-length takeover) AND still fits above a soft
          // keyboard on most phones. The keyboard NEVER changes the height — the sheet
          // translates up by `--kb-shift` instead.
          // Desktop: centred card at one fixed height, so a tall form screen and a short
          // review screen share the same frame and the crossfade has nothing to resize.
          style={{ ["--kb-shift" as string]: `${kbShift}px` }}
          className={cn(
            "fixed z-[81] flex flex-col overflow-hidden border border-border bg-card text-foreground shadow-lg outline-none dark:shadow-none",
            "rounded-[clamp(1.25rem,5vw,2rem)]",
            "transition-transform duration-base ease-standard",
            // mobile
            "inset-x-2 top-[calc(var(--site-nav-height)+env(safe-area-inset-top)+0.5rem)] bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] max-h-[38rem] translate-y-[calc(var(--kb-shift)*-1)]",
            // desktop
            "sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:h-[min(88svh,44rem)] sm:max-h-none sm:w-[min(36rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2",
            className,
          )}
          onEscapeKeyDown={(event) => {
            if (!canDismiss) {
              event.preventDefault();
              return;
            }
            if (depth > 1) {
              event.preventDefault();
              handleBack();
            }
            // depth === 1 && dismissable → let Radix close via onOpenChange.
          }}
          // Never close on an outside tap — guards in-progress input.
          onInteractOutside={(event) => event.preventDefault()}
        >
          {/* ── Header ── Back (depth>1) / Close (root, dismissable); crossfading title. */}
          <div className="relative flex min-h-[3.75rem] shrink-0 flex-col justify-center gap-1 border-b border-border bg-card/95 px-4 pb-3.5 pt-3.5 text-left sm:min-h-[4.25rem] sm:px-6 sm:pb-4 sm:pt-4">
            {depth > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                aria-label={t("common.back")}
                className="btn-interactive absolute left-2.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/90 shadow-sm focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] active:scale-[0.97] active:duration-tap sm:left-3"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : null}
            <div className={cn(depth > 1 && "pl-11 sm:pl-12", canDismiss && "pr-11 sm:pr-12")}>
              <DialogPrimitive.Title asChild>
                <div className="type-dialog-title text-foreground">
                  <motion.span
                    key={activeKey}
                    initial={fadeReadyRef.current ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={crossfadeTransition}
                    className="inline-block"
                  >
                    {active?.title}
                  </motion.span>
                </div>
              </DialogPrimitive.Title>
            </div>
            {active?.banner ? (
              <div className={cn("mt-1.5", depth > 1 && "pl-11 sm:pl-12", canDismiss && "pr-11 sm:pr-12")}>
                {active.banner}
              </div>
            ) : null}
            {/* Scroll progress, mounted on the header's bottom edge — shows how far
                the body is scrolled, with a visible stub at 0%. */}
            <ScrollFadeBar handles={scrollHandles} className="bottom-0" />
            {depth === 1 && canDismiss ? (
              <DialogPrimitive.Close
                aria-label={t("common.close")}
                className="btn-interactive absolute right-2.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/90 shadow-sm focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] active:scale-[0.97] active:duration-tap sm:right-3"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            ) : null}
          </div>

          {/* ── Body ── the stable frame; the active screen crossfades in. */}
          {/* `data-form-body` marks the scroll bounds an inline PickerDropdown
              measures itself against (room above vs below the field). overflow-x
              stays hidden: with overflow-y:auto the other axis computes to `auto`
              regardless, so leaving it "visible" wouldn't spare a dropdown's shadow
              — it would only risk a stray horizontal scrollbar. The body's own
              padding gives the shadow room to render. */}
          <div
            data-form-body=""
            data-kb-shift={kbShiftAttr}
            ref={setBodyRef}
            className={cn(
              "relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6",
              // No native scrollbar track — the header's progress bar is the
              // scrollability affordance. Scrolling itself is untouched.
              "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
          >
            <motion.div
              key={activeKey}
              initial={fadeReadyRef.current ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={crossfadeTransition}
            >
              {active?.body}
            </motion.div>
          </div>

          {/* ── Footer ── pinned; the active screen's actions. */}
          {active?.footer ? (
            <div className="shrink-0 border-t border-border bg-card/95 px-4 py-3 sm:px-6">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-2 [&>*]:w-full sm:[&>*]:w-auto">
                {active.footer}
              </div>
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
