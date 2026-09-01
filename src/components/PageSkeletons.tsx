import { useI18n } from "@/hooks/useI18n";

const SkeletonBlock = ({ className }: { className: string }) => (
  <div className={`skeleton-block ${className}`} aria-hidden="true" />
);

// One day's loading card — fills its grid cell so it can occupy a calendar slot
// while data loads (the slot then fills with a real DayBox in place). Its min-height
// and radius MUST match a booked DayBox (DayBox.tsx) exactly, so booked days don't
// resize when the fetched bookings land in place (free days still compact, but those
// are empty — no content jumps).
export const DaySkeletonCard = () => (
  <div className="flex h-full w-full min-h-[clamp(9.5rem,38vw,13rem)] flex-col rounded-[var(--radius-lg)] p-3 shadow-sm frost-panel dark:shadow-none sm:p-4" aria-hidden="true">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="space-y-2">
        <SkeletonBlock className="h-3 w-12 rounded-full" />
        <SkeletonBlock className="h-12 w-14 rounded-xl" />
      </div>
      <SkeletonBlock className="h-3 w-16 rounded-full" />
    </div>
    <div className="mt-auto space-y-2">
      <SkeletonBlock className="h-10 w-full rounded-lg" />
      <SkeletonBlock className="h-10 w-[88%] rounded-lg" />
    </div>
  </div>
);

export const BacklineSkeleton = () => {
  const { t } = useI18n();

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:gap-6" aria-label={t("skeleton.loadingBacklineContent")}>
      {Array.from({ length: 2 }).map((_, index) => (
        <article key={index} className="flex min-h-[32rem] flex-col rounded-[2rem] bg-card p-4 shadow-md dark:border dark:border-border sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              <SkeletonBlock className="h-3 w-20 rounded-full" />
              <SkeletonBlock className="h-10 w-64 max-w-full rounded-xl" />
            </div>
            <SkeletonBlock className="h-10 w-10 rounded-full" />
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <SkeletonBlock className="h-10 w-full rounded-full sm:w-24" />
            <SkeletonBlock className="h-10 w-full rounded-full sm:w-32" />
          </div>
          <div className="mt-5 flex min-h-0 flex-1 flex-col rounded-[1.5rem] bg-muted p-4">
            <SkeletonBlock className="min-h-0 flex-1 rounded-[1.1rem]" />
          </div>
        </article>
      ))}
    </div>
  );
};
