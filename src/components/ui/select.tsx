import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { popoverPrimitiveMotionClass } from "@/lib/motion";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-none transition-[border-color,box-shadow,background-color,opacity] placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    // Just the chevron on a small chip, IN FLOW (not overlaying the list) so it never
    // covers or dims a real option — an overlay would sit right on a centred digit.
    // Radix only mounts it when there's more above, so it vanishes at the very top.
    // pointer-events-none = no hover auto-scroll; the list scrolls by wheel/drag only.
    className={cn("pointer-events-none relative z-10 flex cursor-default justify-center bg-card py-1", className)}
    {...props}
  >
    <span className="flex h-5 w-7 items-center justify-center rounded-full border border-border bg-card">
      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    // Just the chevron on a small chip, IN FLOW (not overlaying the list) so it never
    // covers or dims a real option — an overlay would sit right on a centred digit.
    // Radix only mounts it when there's more below, so it vanishes at the very bottom.
    // pointer-events-none = no hover auto-scroll; the list scrolls by wheel/drag only.
    className={cn("pointer-events-none relative z-10 flex cursor-default justify-center bg-card py-1", className)}
    {...props}
  >
    <span className="flex h-5 w-7 items-center justify-center rounded-full border border-border bg-card">
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", sideOffset = 6, ...props }, ref) => (
  <SelectContentInner ref={ref} className={className} position={position} sideOffset={sideOffset} {...props}>
    {children}
  </SelectContentInner>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectContentInner = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", sideOffset = 6, ...props }, ref) => {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-[90] max-h-96 min-w-[8rem] overflow-hidden rounded-[1rem] border border-border bg-card text-foreground shadow-lg dark:shadow-none",
          popoverPrimitiveMotionClass,
          className,
        )}
        position={position}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            // NOTE: intentionally NOT pinning height to --radix-select-trigger-height.
            // That pins the scroll area to the (tiny) trigger and fights the content's
            // max-h, causing reflow jank. Let content + max-h govern; the viewport scrolls.
            "p-1",
            position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContentInner.displayName = "SelectContentInner";

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-[0.65rem] py-1.5 pl-8 pr-2 text-sm outline-none transition-[background-color,color,opacity] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-interactive focus:text-interactive-text",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
