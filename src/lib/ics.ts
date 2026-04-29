import { format } from "date-fns";

type CalendarEntry = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string | null;
  location?: string | null;
};

const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");

const formatIcsDate = (date: Date) =>
  date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const foldLine = (line: string) => {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    chunks.push(rest.slice(0, 73));
    rest = ` ${rest.slice(73)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
};

export const createIcsCalendar = (entries: CalendarEntry[]) => {
  const now = formatIcsDate(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Eusoff Bandits//Band Room//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...entries.flatMap((entry) => [
      "BEGIN:VEVENT",
      `UID:${escapeText(entry.uid)}@eusoff-bandits`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatIcsDate(entry.start)}`,
      `DTEND:${formatIcsDate(entry.end)}`,
      `SUMMARY:${escapeText(entry.title)}`,
      entry.description ? `DESCRIPTION:${escapeText(entry.description)}` : "",
      entry.location ? `LOCATION:${escapeText(entry.location)}` : "",
      "END:VEVENT",
    ].filter(Boolean)),
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n");
};

export const downloadIcs = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const calendarFilename = (label: Date) => `eusoff-bandits-${format(label, "yyyy-MM-dd")}.ics`;
