import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow cursor-pointer overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-interactive" />
    </SliderPrimitive.Track>
    {/* Thumb reads as grabbable on desktop: a grab/grabbing cursor, a hover ring +
        slight grow, and an invisible expanded hit area (before:-inset-2) so a mouse
        grabs it without pixel-hunting the 20px circle. Hover affordances are gated to
        a fine hover-capable pointer so touch — which already drags well — is untouched
        and can't get a stuck hover state after a tap. */}
    <SliderPrimitive.Thumb className="relative block h-5 w-5 cursor-grab rounded-full border-2 border-interactive-border bg-background outline-none transition-[border-color,box-shadow,transform,opacity] duration-fast before:absolute before:-inset-2 before:content-[''] focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50 [@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 [@media(hover:hover)_and_(pointer:fine)]:hover:border-interactive [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[0_0_0_4px_hsl(var(--foreground)/0.08)]" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
