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
  adminMode?: boolean;
  ensureAdminSession?: () => Promise<boolean>;
}

type Recurrence = "none" | "daily" | "weekly" | "monthly";
type BookingFormErrors = Partial<Record<"name" | "contact" | "date" | "startTime" | "endTime" | "recurrenceEnd" | "turnstile", string>>;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100, "Name must be 100 characters or fewer."),
  contact: z.string().trim().min(1, "Contact is required.").max(100, "Contact must be 100 characters or fewer."),
});

export const BookingForm = ({ open, onClose, approvedBookings, onSubmitted, editing, adminMode = false, ensureAdminSession }: Props) => {
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
  const [errors, setErrors] = useState<BookingFormErrors>({});
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
      setErrors({});
    } else {
      setName(""); setContact(""); setDate(today); setStartTime("19:00");
      setUseDuration(true); setDurationH(2); setEndTime("21:00");
      setRgb([180, 140, 200]); setRecurrence("none"); setRecurrenceEnd("");
      setTurnstileToken("");
      setErrors({});
      setTurnstileResetSignal((value) => value + 1);
    }
  }, [open, today, editing]);

  const handleTurnstileToken = useCallback((token: string) => {
    setTurnstileToken(token);
    setErrors((current) => ({ ...current, turnstile: token ? undefined : current.turnstile }));
  }, []);

  const handleTurnstileExpired = useCallback(() => {
    setTurnstileToken("");
    setErrors((current) => ({
      ...current,
      turnstile: "Verification expired. Please complete the challenge again.",
    }));
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileToken("");
    setErrors((current) => ({
      ...current,
      turnstile: "Verification failed to load. Please try again.",
    }));
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

  const validate = () => {
    const nextErrors: BookingFormErrors = {};
    const parsed = schema.safeParse({ name, contact });
    if (!parsed.success) {
      for (const issue of parsed.error.errors) {
        const field = issue.path[0];
        if (field === "name" || field === "contact") nextErrors[field] = issue.message;
      }
    }
    if (!date) nextErrors.date = "Date is required.";
    if (!startTime) nextErrors.startTime = "Start time is required.";
    if (!useDuration && !endTime) nextErrors.endTime = "End time is required.";
    if (!(end > start)) nextErrors.endTime = "End time must be after start time.";
    if (!isEdit && recurrence !== "none" && !recurrenceEnd) {
      nextErrors.recurrenceEnd = "Repeat-until date is required for recurring bookings.";
    }
    if (!isEdit && !adminMode && !turnstileSiteKey) {
      nextErrors.turnstile = "Booking verification is not configured.";
    }
    if (!isEdit && !adminMode && turnstileSiteKey && !turnstileToken) {
      nextErrors.turnstile = nextErrors.turnstile || "Please complete the verification challenge.";
    }
    setErrors(nextErrors);
    return nextErrors;
  };

  const submit = async () => {
    if (submitting) return;
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) return;
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

      if (adminMode) {
        if (ensureAdminSession && !(await ensureAdminSession())) return;
        let groupId: string | null = null;
        if (recurrence !== "none" && rows.length > 1) {
          const { data: group, error: groupError } = await supabase
            .from("booking_groups")
            .insert({
              recurrence,
              recurrence_end: recurrenceEnd || null,
            })
            .select("id")
            .single();
          if (groupError) throw groupError;
          groupId = group.id;
        }

        const { error } = await supabase.from("bookings").insert(
          rows.map((row) => ({
            ...row,
            group_id: groupId,
            name: name.trim(),
            contact: contact.trim(),
            color_r: rgb[0],
            color_g: rgb[1],
            color_b: rgb[2],
            status: "approved" as const,
          })),
        );
        if (error) throw error;
        toast.success("Booking added to calendar.");
        onSubmitted();
        onClose();
        return;
      }

      if (!turnstileSiteKey) {
        setErrors((current) => ({ ...current, turnstile: "Booking verification is not configured." }));
        return;
      }
      if (!turnstileToken) {
        setErrors((current) => ({ ...current, turnstile: "Please complete the verification challenge." }));
        return;
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
      toast.error(getErrorMessage(error, "Failed to submit"), { duration: 3500 });
      setTurnstileToken("");
      setErrors((current) => ({
        ...current,
        turnstile: "Please complete a fresh verification challenge before trying again.",
      }));
      setTurnstileResetSignal((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const swatch = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[min(90svh,48rem)] w-[min(calc(100vw-1rem),calc(100%-2rem))] max-w-[min(32rem,calc(100vw-1rem))] overflow-x-hidden overflow-y-auto rounded-[clamp(1.25rem,5vw,2rem)] sm:rounded-[clamp(1.25rem,5vw,2rem)] animate-pop-in">
        <DialogHeader>
          <DialogTitle className="font-display text-[clamp(1.5rem,6vw,2rem)]">{isEdit ? "Edit booking" : adminMode ? "Add Booking" : "Request a booking"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Changes apply immediately to this booking."
              : adminMode
                ? "Add this booking directly to the approved calendar."
                : "Pending requests are reviewed by an admin before appearing."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="mobile-safe-form-grid grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                className="w-full min-w-0 max-w-full"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((current) => ({ ...current, name: undefined }));
                }}
                maxLength={100}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "booking-name-error" : undefined}
              />
              {errors.name && <p id="booking-name-error" className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="contact">Telegram handle</Label>
              <Input
                id="contact"
                className="w-full min-w-0 max-w-full"
                placeholder="@yourhandle"
                value={contact}
                onChange={(e) => {
                  setContact(e.target.value);
                  setErrors((current) => ({ ...current, contact: undefined }));
                }}
                maxLength={100}
                aria-invalid={!!errors.contact}
                aria-describedby={errors.contact ? "booking-contact-error" : undefined}
              />
              {errors.contact && <p id="booking-contact-error" className="text-xs text-destructive">{errors.contact}</p>}
            </div>
          </div>

          <div className="mobile-safe-form-grid grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                className="w-full min-w-0 max-w-full"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setErrors((current) => ({ ...current, date: undefined, endTime: undefined }));
                }}
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? "booking-date-error" : undefined}
              />
              {errors.date && <p id="booking-date-error" className="text-xs text-destructive">{errors.date}</p>}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="start">Start time</Label>
              <Input
                id="start"
                type="time"
                className="w-full min-w-0 max-w-full"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setErrors((current) => ({ ...current, startTime: undefined, endTime: undefined }));
                }}
                aria-invalid={!!errors.startTime}
                aria-describedby={errors.startTime ? "booking-start-error" : undefined}
              />
              {errors.startTime && <p id="booking-start-error" className="text-xs text-destructive">{errors.startTime}</p>}
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
                <Slider
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={[durationH]}
                  onValueChange={(v) => {
                    setDurationH(v[0]);
                    setErrors((current) => ({ ...current, endTime: undefined }));
                  }}
                />
                {errors.endTime && <p className="text-xs text-destructive">{errors.endTime}</p>}
              </div>
            ) : (
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="end">End time</Label>
                <Input
                  id="end"
                  type="time"
                  className="w-full min-w-0 max-w-full"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setErrors((current) => ({ ...current, endTime: undefined }));
                  }}
                  aria-invalid={!!errors.endTime}
                  aria-describedby={errors.endTime ? "booking-end-error" : undefined}
                />
                {errors.endTime && <p id="booking-end-error" className="text-xs text-destructive">{errors.endTime}</p>}
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
            <div className="mobile-safe-form-grid grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label>Recurrence</Label>
                <Select
                  value={recurrence}
                  onValueChange={(value) => {
                    setRecurrence(value as Recurrence);
                    setErrors((current) => ({ ...current, recurrenceEnd: undefined }));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rend">Repeat until</Label>
                <Input
                  id="rend"
                  type="date"
                  className="w-full min-w-0 max-w-full"
                  value={recurrenceEnd}
                  onChange={(e) => {
                    setRecurrenceEnd(e.target.value);
                    setErrors((current) => ({ ...current, recurrenceEnd: undefined }));
                  }}
                  disabled={recurrence === "none"}
                  aria-invalid={!!errors.recurrenceEnd}
                  aria-describedby={errors.recurrenceEnd ? "booking-recurrence-error" : undefined}
                />
                {errors.recurrenceEnd && <p id="booking-recurrence-error" className="text-xs text-destructive">{errors.recurrenceEnd}</p>}
              </div>
            </div>
          )}

          {!isEdit && !adminMode && (
            <div className="min-w-0 overflow-hidden rounded-xl border bg-muted/30 p-3">
              {turnstileSiteKey ? (
                <TurnstileWidget
                  siteKey={turnstileSiteKey}
                  onTokenChange={handleTurnstileToken}
                  onExpired={handleTurnstileExpired}
                  onError={handleTurnstileError}
                  resetSignal={turnstileResetSignal}
                />
              ) : (
                <p className="text-sm text-destructive">
                  Booking verification is not configured. Add `VITE_TURNSTILE_SITE_KEY` before accepting public requests.
                </p>
              )}
              {errors.turnstile && <p className="mt-2 text-sm text-destructive">{errors.turnstile}</p>}
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
            <Button onClick={submit} disabled={submitting || !!conflict} className="w-full sm:w-auto">
              {submitting ? "Saving…" : isEdit ? "Save changes" : adminMode ? "Confirm" : "Submit request"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
