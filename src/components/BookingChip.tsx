import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Booking, bookingBg, bookingBorder, bookingDot, fmtTimeRange } from "@/lib/booking-utils";
import { format } from "date-fns";

interface Props {
  booking: Booking;
  day: Date;
  isContinued: boolean;
  compact?: boolean;
}

export const BookingChip = ({ booking, day, isContinued, compact }: Props) => {
  const range = fmtTimeRange(booking, day);
  const fullRange = `${format(new Date(booking.start_time), "MMM d, HH:mm")} → ${format(new Date(booking.end_time), "MMM d, HH:mm")}`;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <div
          className="group rounded-xl px-2 py-1.5 border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-soft cursor-default"
          style={{
            backgroundColor: bookingBg(booking),
            borderColor: bookingBorder(booking),
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: bookingDot(booking) }}
              aria-hidden
            />
            <span className={`truncate font-semibold ${compact ? "text-[clamp(0.68rem,2vw,0.75rem)]" : "text-xs sm:text-sm"}`}>
              {booking.name}
              {isContinued && <span className="opacity-60 font-normal"> (cont.)</span>}
            </span>
          </div>
          <div className={`truncate text-foreground/70 tabular-nums ${compact ? "text-[clamp(0.62rem,1.8vw,0.7rem)]" : "text-[clamp(0.68rem,2vw,0.75rem)]"}`}>
            {range}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-0.5">
          <div className="font-semibold">{booking.name}</div>
          <div className="text-xs opacity-80">@{booking.contact.replace(/^@/, "")}</div>
          <div className="text-xs opacity-80 tabular-nums">{fullRange}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
