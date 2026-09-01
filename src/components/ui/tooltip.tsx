import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipContentInner ref={ref} className={className} sideOffset={sideOffset} {...props} />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const TooltipContentInner = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  // Portalled to <body> so the content escapes any ancestor with overflow:hidden
  // or a backdrop-filter stacking context (e.g. the dark-mode frost-panel day
  // cards) — otherwise the tooltip is clipped / painted beneath neighbouring cards.
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn("z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md", className)}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContentInner.displayName = "TooltipContentInner";

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
