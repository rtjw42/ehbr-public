import * as React from "react";

import { useFieldAria } from "@/components/ui/form-field";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // An enclosing FormField publishes its error id; an explicit prop still wins.
    const field = useFieldAria();
    const describedBy = props["aria-describedby"] ?? field?.errorId ?? undefined;
    const invalid = props["aria-invalid"] ?? (field?.errorId ? true : undefined);
    return (
      <input
        type={type}
        {...props}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground shadow-none transition-[border-color,box-shadow,background-color,opacity] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-foreground/40 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] aria-[invalid=true]:border-destructive/60 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
