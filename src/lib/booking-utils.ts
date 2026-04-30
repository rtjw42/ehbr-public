import { addDays, startOfWeek, endOfWeek, format, isSameDay, startOfDay, endOfDay, addMinutes, addWeeks, addMonths } from "date-fns";

export type Booking = {
  id: string;
  group_id: string | null;
  name: string;
  contact: string;
  start_time: string; // ISO
  end_time: string;   // ISO
  color_r: number;
  color_g: number;
  color_b: number;
  status: "pending" | "approved" | "rejected";
};

export function getWeekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekRange(anchor: Date) {
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const end = endOfWeek(anchor, { weekStartsOn: 1 });
  return { start, end };
}

export function fmtWeekLabel(anchor: Date) {
  const { start, end } = weekRange(anchor);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${format(start, "MMM d")} – ${format(end, "d, yyyy")}`
    : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

/** Returns bookings that intersect a given day, with a flag for "continued". */
export function bookingsForDay(bookings: Booking[], day: Date) {
  const ds = startOfDay(day);
  const de = endOfDay(day);
  return bookings
    .filter((b) => {
      const s = new Date(b.start_time);
      const e = new Date(b.end_time);
      return s <= de && e >= ds;
    })
    .map((b) => {
      const s = new Date(b.start_time);
      const isContinued = !isSameDay(s, day) && s < ds;
      return { booking: b, isContinued };
    })
    .sort((a, b) => new Date(a.booking.start_time).getTime() - new Date(b.booking.start_time).getTime());
}

export function fmtTimeRange(b: Booking, day?: Date) {
  const s = new Date(b.start_time);
  const e = new Date(b.end_time);
  if (day) {
    const ds = startOfDay(day);
    const de = endOfDay(day);
    const showS = s < ds ? "00:00" : format(s, "HH:mm");
    const showE = e > de ? "00:00" : format(e, "HH:mm");
    return `${showS}–${showE}`;
  }
  return `${format(s, "HH:mm")}–${format(e, "HH:mm")}`;
}

export function bookingBg(b: Pick<Booking, "color_r" | "color_g" | "color_b">) {
  return `rgba(${b.color_r}, ${b.color_g}, ${b.color_b}, 0.22)`;
}
export function bookingBorder(b: Pick<Booking, "color_r" | "color_g" | "color_b">) {
  return `rgba(${b.color_r}, ${b.color_g}, ${b.color_b}, 0.65)`;
}
export function bookingDot(b: Pick<Booking, "color_r" | "color_g" | "color_b">) {
  return `rgb(${b.color_r}, ${b.color_g}, ${b.color_b})`;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

/** Generate recurrence instances (Date pairs) up to recurrence_end (inclusive). */
export function expandRecurrence(
  start: Date,
  end: Date,
  recurrence: "none" | "daily" | "weekly" | "monthly",
  recurrenceEnd: Date | null,
): { start: Date; end: Date }[] {
  if (recurrence === "none" || !recurrenceEnd) return [{ start, end }];
  const out: { start: Date; end: Date }[] = [];
  let s = start;
  let e = end;
  let safety = 0;
  while (s <= recurrenceEnd && safety < 366) {
    out.push({ start: s, end: e });
    if (recurrence === "daily") { s = addDays(s, 1); e = addDays(e, 1); }
    else if (recurrence === "weekly") { s = addWeeks(s, 1); e = addWeeks(e, 1); }
    else { s = addMonths(s, 1); e = addMonths(e, 1); }
    safety++;
  }
  return out;
}

export function combineDateTime(dateStr: string, timeStr: string): Date {
  // dateStr: yyyy-MM-dd, timeStr: HH:mm
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mn] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, h, mn, 0, 0);
}

export function addHours(d: Date, h: number) {
  return addMinutes(d, h * 60);
}
