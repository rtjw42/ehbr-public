import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { useI18n } from "@/hooks/useI18n";
import { ScrollFadeBar, useScrollFadeHandles, useScrollFadeWriter, type ScrollFadeHandles } from "@/components/ui/scroll-fade";
import { cn } from "@/lib/utils";

// This primitive owns its entrance/exit animation via Radix data attributes.
// Consumers must not add animation classes to DialogContent.
const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const assignRef = <T,>(ref: React.Ref<T> | undefined, node: T) => {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(node);
    return;
  }
  (ref as React.MutableRefObject<T | null>).current = node;
};

const useComposedRefs = <T,>(firstRef: React.Ref<T> | undefined, secondRef: React.Ref<T> | undefined) => (
  React.useCallback((node: T) => {
    assignRef(firstRef, node);
    assignRef(secondRef, node);
  }, [firstRef, secondRef])
);

// Scroll progress is fully imperative (see scroll-fade.tsx): the context only
// shares a stable ref between the body (writer) and the header (bar), so no
// scroll tick or content-resize frame ever re-renders the dialog chrome.
const DialogScrollContext = React.createContext<ScrollFadeHandles | null>(null);

const useDialogScrollContext = () => React.useContext(DialogScrollContext);

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogOverlayInner ref={ref} className={className} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogOverlayInner = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm dark:bg-black/62",
        "motion-duration-base motion-state-ease data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
});
DialogOverlayInner.displayName = "DialogOverlayInner";

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  scrollRef?: React.Ref<HTMLDivElement>;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, scrollRef: externalScrollRef, ...props }, ref) => {
  const scrollHandles = useScrollFadeHandles();

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogScrollContext.Provider value={scrollHandles}>
        <DialogPrimitive.Content
          ref={ref}
          data-dialog-content=""
          className={cn(
            "fixed left-1/2 top-1/2 z-[81] mx-auto flex w-[calc(100vw_-_1.5rem)] max-w-[min(32rem,calc(100vw_-_1.5rem))] max-h-[min(88svh,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-foreground shadow-lg outline-none dark:shadow-none sm:w-[calc(100vw_-_1rem)] sm:max-w-[min(32rem,calc(100vw_-_1rem))] sm:max-h-[min(90svh,48rem)] sm:rounded-[clamp(1.25rem,5vw,2rem)]",
            className,
          )}
          // Clicking the backdrop must not close the dialog — guards against
          // accidental dismissal that loses form input. Dialogs close via the X,
          // Escape, or their own actions. A consumer can still opt back in by
          // passing its own onInteractOutside.
          onInteractOutside={(event) => event.preventDefault()}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogScrollContext.Provider>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  // Hides the close (X) for read-gated dialogs that must be dismissed a specific way
  // (e.g. a "Got it" button after scrolling). Padding tightens to stay symmetric.
  hideClose?: boolean;
};

const DialogHeader = ({ className, children, hideClose = false, ...props }: DialogHeaderProps) => {
  const ctx = useDialogScrollContext();
  const { t } = useI18n();
  return (
    <div
      data-dialog-header=""
      className={cn(
        // min-height guarantees room for the vertically-centered close button even
        // when the title is a single short line on mobile.
        "relative flex min-h-[3.75rem] shrink-0 flex-col justify-center gap-1.5 border-b border-border bg-card/95 px-4 pb-4 pl-4 pr-16 pt-4 text-left sm:min-h-[4.25rem] sm:px-6 sm:pb-5 sm:pr-16 sm:pt-5",
        hideClose && "pr-4 sm:pr-6",
        className,
      )}
      {...props}
    >
      {children}
      {/* Close lives in the header and is vertically centered against the title,
          so it stays aligned regardless of how tall the title renders. */}
      {!hideClose && (
        <DialogPrimitive.Close className="btn-interactive absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border bg-card/90 shadow-sm focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] active:scale-[0.97] active:duration-tap disabled:pointer-events-none disabled:opacity-50 sm:right-4">
          <X className="h-4 w-4" />
          <span className="sr-only">{t("common.close")}</span>
        </DialogPrimitive.Close>
      )}
      <ScrollFadeBar handles={ctx} className="bottom-0" />
    </div>
  );
};
DialogHeader.displayName = "DialogHeader";

type DialogBodyProps = React.HTMLAttributes<HTMLDivElement> & {
  scrollRef?: React.Ref<HTMLDivElement>;
};

const DialogBody = React.forwardRef<HTMLDivElement, DialogBodyProps>(({ className, scrollRef: externalScrollRef, children, ...props }, ref) => {
  const localScrollRef = React.useRef<HTMLDivElement | null>(null);
  const localAndForwardedRef = useComposedRefs(localScrollRef, ref);
  const composedRef = useComposedRefs(localAndForwardedRef, externalScrollRef);
  const context = useDialogScrollContext();
  useScrollFadeWriter(localScrollRef, context);

  return (
    <div
      ref={composedRef}
      className={cn("dialog-scroll-shell relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6", className)}
      {...props}
    >
      {children}
    </div>
  );
});
DialogBody.displayName = "DialogBody";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("shrink-0 border-t border-border bg-card/95 px-4 py-3 sm:px-6", className)}>
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2 sm:gap-0 [&>*]:w-full sm:[&>*]:w-auto" {...props} />
  </div>
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("type-dialog-title", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
