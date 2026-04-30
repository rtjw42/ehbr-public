import { isSameDay } from "date-fns";

export type EventItem = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_date: string; // ISO
  end_date: string | null;
  poster_url: string | null;
  created_at: string;
  updated_at: string;
};

export function eventsForDay(events: EventItem[], day: Date) {
  return events.filter((e) => isSameDay(new Date(e.event_date), day));
}
