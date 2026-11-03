import { memo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Booking, bookingBg, bookingBorder, bookingDot, fmtDateTime, fmtTimeRange, isBookingOver } from "@/lib/booking-utils";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";

interface Props {
  booking: Booking;
  day: Date;
  isContinued: boolean;
}

export const BookingChip = memo(({ booking, day, isContinued }: Props) => {
  const { language, t } = useI18n();
  const range = fmtTimeRange(booking, day, language);
  const isOver = isBookingOver(booking, day);
  const booker = sanitizeDisplayText(booking.name);
  const fullRange = `${fmtDateTime(booking.start_time, language)} → ${fmtDateTime(booking.end_time, language)}`;

  const title = (
    <>
      {sanitizeDisplayText(booking.title)}
      {isContinued && <span className="opacity-60 font-normal"> ({t("day.continued")})</span>}
    </>
  );

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "group relative rounded-xl border px-2 py-1.5 cursor-default transition-opacity",
            isOver && "opacity-[0.55] dark:opacity-[0.65]",
          )}
          style={{
            backgroundColor: bookingBg(booking),
            borderColor: bookingBorder(booking),
          }}
        >
          {/* Wide mobile chip (single-column week): name + booker on the left, a
              bolder time hugging the right so the timing reads at a glance. */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: bookingDot(booking) }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight">{title}</span>
              {booker && <span className="block truncate text-xs text-foreground/70 sm:hidden">{booker}</span>}
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground/90 sm:hidden">
              {range}
            </span>
          </div>
          {/* Narrow grid chip (sm+ multi-column week): compact time under the
              name, matching the dense desktop layout. */}
          <span className="hidden truncate type-chip text-foreground/70 tabular-nums sm:block">
            {range}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-0.5">
          <div className="font-semibold">{sanitizeDisplayText(booking.title)}</div>
          <div className="text-xs opacity-80">{t("day.bookedBy")}: {booker}</div>
          <div className="text-xs opacity-80 tabular-nums">{fullRange}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
});

BookingChip.displayName = "BookingChip";
