import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderBarProps {
  /** Page title — rendered with the standardized page-heading type. */
  title: ReactNode;
  /** Optional content under the title (eyebrow / subtitle / meta line). Caller-styled. */
  children?: ReactNode;
  /** Optional right-aligned actions (e.g. a primary button). */
  actions?: ReactNode;
  /** Override the inner container max-width to match the page body (default max-w-7xl). */
  containerClassName?: string;
}

/**
 * Shared page header bar — the booking-page header pattern, reused across pages so
 * every title shares one font, size, weight, and vertical position: a dark frosted
 * glass bar (frost-panel) sitting directly under the nav, with title/subtitle text
 * flipped light by the panel's token overrides. This is the single source of the
 * page-title treatment; pages pass their title, optional subtitle, and actions.
 *
 * Renders at rest — the page entrance is owned by the PageTransition wrapper
 * (.page-enter), so the header rides the one page-level entrance, not its own.
 */
export const PageHeaderBar = ({ title, children, actions, containerClassName }: PageHeaderBarProps) => (
  <header
    className={cn("relative z-30 mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6", containerClassName)}
  >
    {/* Floating frosted chip — same shape as the Events / Media headers, so every
        page's header reads as one element rather than a full-bleed bar. */}
    <div className="flex w-full flex-col gap-4 rounded-2xl px-5 py-5 shadow-sm frost-panel dark:shadow-none sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <h1 className="type-page-title text-foreground">
          {title}
        </h1>
        {children}
      </div>
      {/* Mobile-first: the action stretches full-width below the title (a proper
          tap target), then collapses to a compact pill in the corner on desktop. */}
      {actions ? <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{actions}</div> : null}
    </div>
  </header>
);
