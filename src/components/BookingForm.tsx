import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check } from "lucide-react";
import { z } from "zod";
import { addHours, combineDateTime, expandRecurrence, overlaps, Booking } from "@/lib/booking-utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { getErrorMessage } from "@/lib/errors";

// 8 Bauhaus-inspired booking colors
const COLOR_PRESETS: { name: string; rgb: [number, number, number] }[] = [
  { name: "Lavender", rgb: [180, 140, 200] },
  { name: "Coral",    rgb: [231, 111,  81] },
  { name: "Mustard",  rgb: [233, 196,  84] },
  { name: "Olive",    rgb: [138, 154,  91] },
  { name: "Teal",     rgb: [ 70, 150, 158] },
  { name: "Indigo",   rgb: [ 90, 100, 180] },
  { name: "Rose",     rgb: [217, 130, 165] },
  { name: "Cocoa",    rgb: [120,  85,  72] },
];

interface Props {
  open: boolean;
  onClose: () => void;
  approvedBookings: Booking[];
  onSubmitted: () => void;
  /** When provided, the form edits this booking instead of creating a new one. */
  editing?: Booking | null;
}

type Recurrence = "none" | "daily" | "weekly" | "monthly";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  contact: z.string().trim().min(1, "Required").max(100),
});

export const BookingForm = ({ open, onClose, approvedBookings, onSubmitted, editing }: Props) => {
  const today = format(new Date(), "yyyy-MM-dd");
  const isEdit = !!editing;
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("19:00");
  const [useDuration, setUseDuration] = useState(true);
  const [durationH, setDurationH] = useState(2);
  const [endTime, setEndTime] = useState("21:00");
  const [rgb, setRgb] = useState<[number, number, number]>([180, 140, 200]);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [recurrenceEnd, setRecurrenceEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  // Reset/prefill on open
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const s = new Date(editing.start_time);
      const e = new Date(editing.end_time);
      setName(editing.name);
      setContact(editing.contact);
      setDate(format(s, "yyyy-MM-dd"));
      setStartTime(format(s, "HH:mm"));
      setUseDuration(false);
      setEndTime(format(e, "HH:mm"));
      setDurationH(Math.max(0.5, (e.getTime() - s.getTime()) / 3600000));
      setRgb([editing.color_r, editing.color_g, editing.color_b]);
      setRecurrence("none");
      setRecurrenceEnd("");
    } else {
      setName(""); setContact(""); setDate(today); setStartTime("19:00");
      setUseDuration(true); setDurationH(2); setEndTime("21:00");
      setRgb([180, 140, 200]); setRecurrence("none"); setRecurrenceEnd("");
      setTurnstileToken("");
      setTurnstileResetSignal((value) => value + 1);
    }
  }, [open, today, editing]);

  const handleTurnstileToken = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  // Computed start/end
  const { start, end } = useMemo(() => {
    const s = combineDateTime(date, startTime);
    const e = useDuration ? addHours(s, durationH) : combineDateTime(date, endTime);
    return { start: s, end: e };
  }, [date, startTime, useDuration, durationH, endTime]);

  // Auto-update end-time field when start/duration changes (for display in end-time mode toggle)
  useEffect(() => {
    if (!useDuration) return;
    if (!date || !startTime) return;
    const s = combineDateTime(date, startTime);
    if (isNaN(s.getTime())) return;
    const e = addHours(s, durationH);
    if (isNaN(e.getTime())) return;
    setEndTime(format(e, "HH:mm"));
  }, [useDuration, date, startTime, durationH]);

  // Real-time conflict (ignore the booking being edited)
  const conflict = useMemo(() => {
    if (!(end > start)) return null;
    const instances = recurrence === "none"
      ? [{ start, end }]
      : recurrenceEnd
        ? expandRecurrence(start, end, recurrence, new Date(recurrenceEnd + "T23:59:59"))
        : [{ start, end }];
    for (const inst of instances) {
      for (const b of approvedBookings) {
        if (editing && b.id === editing.id) continue;
        if (overlaps(inst.start, inst.end, new Date(b.start_time), new Date(b.end_time))) {
          return `Conflicts with "${b.name}" on ${format(inst.start, "MMM d HH:mm")}`;
        }
      }
    }
    return null;
  }, [start, end, recurrence, recurrenceEnd, approvedBookings, editing]);

  const submit = async () => {
    const parsed = schema.safeParse({ name, contact });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message, { duration: 2000 });
      return;
    }
    if (!(end > start)) {
      toast.error("End must be after start", { duration: 2000 });
      return;
    }
    if (conflict) {
      toast.error(conflict, { duration: 2000 });
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && editing) {
        const { error } = await supabase
          .from("bookings")
          .update({
            name: name.trim(),
            contact: contact.trim(),
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            color_r: rgb[0], color_g: rgb[1], color_b: rgb[2],
          })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Booking updated");
        onSubmitted();
        onClose();
        return;
      }

      const instances = recurrence === "none"
        ? [{ start, end }]
        : recurrenceEnd
          ? expandRecurrence(start, end, recurrence, new Date(recurrenceEnd + "T23:59:59"))
          : [{ start, end }];

      const rows = instances.map((inst) => ({
        start_time: inst.start.toISOString(),
        end_time: inst.end.toISOString(),
      }));

      if (!turnstileSiteKey) {
        throw new Error("Booking verification is not configured");
      }
      if (!turnstileToken) {
        throw new Error("Please complete the verification challenge");
      }

      const { data, error } = await supabase.functions.invoke("submit-booking", {
        body: {
          turnstileToken,
          booking: {
            name: name.trim(),
            contact: contact.trim(),
            recurrence,
            recurrence_end: recurrenceEnd || null,
            color_r: rgb[0],
            color_g: rgb[1],
            color_b: rgb[2],
            bookings: rows,
          },
        },
      });
      if (error) {
        const context = (error as { context?: Response }).context;
        if (context) {
          let bodyError = "";
          try {
            const body = await context.clone().json() as { error?: unknown };
            bodyError = typeof body.error === "string" ? body.error : "";
          } catch {
            bodyError = "";
          }
          throw new Error(bodyError || error.message);
        }
        throw error;
      }
      if (data && typeof data === "object" && "error" in data) {
        throw new Error(String(data.error));
      }

      toast.success(`Request submitted (${rows.length} ${rows.length === 1 ? "session" : "sessions"}). Awaiting admin approval.`);
      setTurnstileToken("");
      setTurnstileResetSignal((value) => value + 1);
      onSubmitted();
      onClose();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to submit"), { duration: 2000 });
      setTurnstileToken("");
      setTurnstileResetSignal((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const swatch = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[min(90svh,48rem)] w-[min(calc(100vw-1rem),calc(100%-2rem))] max-w-[min(32rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl animate-pop-in">
        <DialogHeader>
          <DialogTitle className="font-display text-[clamp(1.5rem,6vw,2rem)]">{isEdit ? "Edit booking" : "Request a booking"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Changes apply immediately to this booking." : "Pending requests are reviewed by an admin before appearing."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact">Telegram handle</Label>
              <Input id="contact" placeholder="@yourhandle" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="start">Start time</Label>
              <Input id="start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          </div>

          <div className="rounded-xl border p-3 bg-muted/40 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Use duration instead of end time</Label>
              <Switch checked={useDuration} onCheckedChange={setUseDuration} />
            </div>
            {useDuration ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="font-medium tabular-nums">{durationH.toFixed(1)} h</span>
                </div>
                <Slider min={0.5} max={8} step={0.5} value={[durationH]} onValueChange={(v) => setDurationH(v[0])} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="end">End time</Label>
                <Input id="end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </div>
            )}
          </div>

          <div className="rounded-xl border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Booking color</Label>
              <div className="h-7 w-12 rounded-md border" style={{ backgroundColor: swatch }} />
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {COLOR_PRESETS.map((c) => {
                const selected = rgb[0] === c.rgb[0] && rgb[1] === c.rgb[1] && rgb[2] === c.rgb[2];
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setRgb(c.rgb)}
                    aria-label={c.name}
                    title={c.name}
                    className="relative aspect-square rounded-full border-2 transition-transform hover:scale-110 active:scale-95"
                    style={{
                      backgroundColor: `rgb(${c.rgb[0]}, ${c.rgb[1]}, ${c.rgb[2]})`,
                      borderColor: selected ? "hsl(var(--ring))" : "transparent",
                      boxShadow: selected ? "0 0 0 2px hsl(var(--background))" : undefined,
                    }}
                  >
                    {selected && (
                      <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" strokeWidth={3} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {!isEdit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Recurrence</Label>
                <Select value={recurrence} onValueChange={(value) => setRecurrence(value as Recurrence)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rend">Repeat until</Label>
                <Input id="rend" type="date" value={recurrenceEnd} onChange={(e) => setRecurrenceEnd(e.target.value)} disabled={recurrence === "none"} />
              </div>
            </div>
          )}

          {!isEdit && (
            <div className="rounded-xl border bg-muted/30 p-3">
              {turnstileSiteKey ? (
                <TurnstileWidget
                  siteKey={turnstileSiteKey}
                  onTokenChange={handleTurnstileToken}
                  resetSignal={turnstileResetSignal}
                />
              ) : (
                <p className="text-sm text-destructive">
                  Booking verification is not configured. Add `VITE_TURNSTILE_SITE_KEY` before accepting public requests.
                </p>
              )}
            </div>
          )}

          {conflict && (
            <div
              key={conflict}
              className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2"
              style={{ animation: "fade-out-soft 2s ease-out forwards", animationDelay: "1.5s" }}
            >
              {conflict}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} disabled={submitting} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={submit} disabled={submitting || !!conflict || (!isEdit && !turnstileToken)} className="w-full sm:w-auto">
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Submit request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
