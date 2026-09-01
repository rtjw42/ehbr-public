import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { popoverPrimitiveMotionClass } from "@/lib/motion";
import { cn } from "@/lib/utils";

// This primitive owns its entrance/exit animation via Radix data attributes.
// Consumers must not add animation classes to PopoverContent.
const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverContentInner ref={ref} className={className} align={align} sideOffset={sideOffset} {...props} />
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const PopoverContentInner = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-[1.35rem] border border-border bg-card p-4 text-foreground shadow-lg outline-none dark:shadow-none",
          popoverPrimitiveMotionClass,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContentInner.displayName = "PopoverContentInner";

export { Popover, PopoverTrigger, PopoverContent };
