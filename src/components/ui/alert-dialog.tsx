import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ScrollFadeBar, useScrollFadeHandles, useScrollFadeWriter, type ScrollFadeHandles } from "@/components/ui/scroll-fade";

// This primitive owns its entrance/exit animation via Radix data attributes.
// Consumers must not add animation classes to AlertDialogContent.
const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

// Scroll progress is fully imperative and shared with dialog.tsx (see
// scroll-fade.tsx) — this file previously carried a drifted copy that still
// transitioned `transform` (the scaleX lag the dialog version had fixed).
const AlertScrollContext = React.createContext<ScrollFadeHandles | null>(null);

const useAlertScrollContext = () => React.useContext(AlertScrollContext);

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogOverlayInner ref={ref} className={className} {...props} />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogOverlayInner = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  return (
    <AlertDialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm dark:bg-black/62",
        "motion-duration-base motion-state-ease data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
      ref={ref}
    />
  );
});
AlertDialogOverlayInner.displayName = "AlertDialogOverlayInner";

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const scrollHandles = useScrollFadeHandles();

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertScrollContext.Provider value={scrollHandles}>
        <AlertDialogPrimitive.Content
          ref={ref}
          className={cn(
            "fixed left-1/2 top-1/2 z-[81] mx-auto flex w-[calc(100vw_-_1.5rem)] max-w-[min(32rem,calc(100vw_-_1.5rem))] max-h-[min(88svh,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-foreground shadow-lg outline-none dark:shadow-none sm:w-[calc(100vw_-_1rem)] sm:max-w-[min(32rem,calc(100vw_-_1rem))] sm:max-h-[min(90svh,48rem)] sm:rounded-[clamp(1.25rem,5vw,2rem)]",
            className,
          )}
          {...props}
        >
          {children}
        </AlertDialogPrimitive.Content>
      </AlertScrollContext.Provider>
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-header=""
    className={cn(
      "shrink-0 space-y-2 border-b border-border bg-card/95 px-4 pb-3 pt-4 text-left sm:px-6 sm:pb-4 sm:pt-6",
      className,
    )}
    {...props}
  />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, children, ...props }, ref) => {
  const localScrollRef = React.useRef<HTMLDivElement | null>(null);
  const context = useAlertScrollContext();

  React.useImperativeHandle(ref, () => localScrollRef.current as HTMLDivElement);
  useScrollFadeWriter(localScrollRef, context);

  return (
    <div
      ref={localScrollRef}
      className={cn("dialog-scroll-shell relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6", className)}
      {...props}
    >
      <ScrollFadeBar handles={context} className="top-0" />
      {children}
    </div>
  );
});
AlertDialogBody.displayName = "AlertDialogBody";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("shrink-0 border-t border-border bg-card/95 px-4 py-3 sm:px-6", className)}>
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2 sm:gap-0 [&>*]:w-full sm:[&>*]:w-auto" {...props} />
  </div>
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={cn("type-dialog-title", className)} {...props} />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
