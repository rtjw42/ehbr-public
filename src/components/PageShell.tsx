import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  /** Pass true for pages with a full-bleed hero that intentionally overlaps the nav */
  hero?: boolean;
}

export const PageShell = ({ children, className, hero = false }: PageShellProps) => (
  <div
    className={cn(
      "relative min-h-lvh min-w-0 flex-1",
      // Offset clears the fixed nav; +safe-area-inset-top because viewport-fit=cover
      // drops the nav below the notch (env() is 0 on non-notched devices).
      !hero && "pt-[calc(var(--site-nav-height)+env(safe-area-inset-top))]",
      className,
    )}
  >
    {children}
  </div>
);
