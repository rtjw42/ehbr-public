// ── Booking form ─────────────────────────────────────────────────────────────
// One form serving three modes: public request, admin create, and admin edit.
// Public submits run a Turnstile sub-flow (the VerificationState machine below)
// before calling the submit-booking Edge Function; admin create/edit go straight to
// the RPC-backed services after ensureAdminSession() re-verifies the live session.
// Conflict checks run against approvedBookings PLUS a targeted fetch for the exact
// dates being submitted (the prop only covers the calendar's visible week) — the
// database's exclude constraint is still the final source of truth.
//
// ── Form System (2026-08) ────────────────────────────────────────────────────
// Rendered through <FormShell> as a STACK OF SCREENS (see DESIGN_SYSTEM → Form
// System). The frame NEVER resizes — not between screens, not when the keyboard
// opens — and screens crossfade on opacity alone. Date/time pickers are pushed
// SUB-SCREENS (a value FieldRow shows the current value and pushes a full-frame
// calendar/wheel), which replaced the old inline-expanding panels: no layout push,
// no scroll pan, no sub-pixel text blur.
//
// All scheduling logic below — conflict detection, recurrence, the open-seed, the
// duration/end derivation and the Turnstile machine — is unchanged from the FLIP
// era; only the presentation moved.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { AlertTriangle, Calendar as CalendarIcon, Check, CheckCircle2, Clock, Loader2, X } from "lucide-react";
import { addHours, clampStartToFloor, combineDateTime, fmtBookingSpan, fmtDate, isMultiDay, nextAvailableSlot, overlapsMs, snapUpTo15, Booking } from "@/lib/booking-utils";
import { toast } from "sonner";
import { format, addDays, addMonths, addWeeks, endOfMonth, isBefore } from "date-fns";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { crossfadeTransition } from "@/lib/motion";
import { FormShell, type FormScreen } from "@/components/ui/form-shell";
import { FieldRow } from "@/components/ui/field-row";
import { PickerDropdown } from "@/components/ui/picker-dropdown";
import { CalendarPanel } from "@/components/ui/calendar-panel";
import { TimeWheel } from "@/components/ui/time-wheel";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { getErrorMessage } from "@/lib/errors";
import { sanitizeDisplayText, stripHtmlText } from "@/lib/sanitize";
import { containsLink } from "@/lib/text-guard";
import { useI18n } from "@/hooks/useI18n";
import { usePreferences } from "@/hooks/usePreferences";
import { formatClockRange, formatClockTime, formatLocalizedDate, getDateLocale } from "@/lib/date";
import { cn } from "@/lib/utils";
import {
  BookingSubmitError,
  buildBookingRowsFromIntent,
  createApprovedAdminBookings,
  loadApprovedBookingsForWindow,
  submitPublicBookingRequest,
  updateBooking,
  type BookingInstanceInput,
  type BookingRecurrence,
} from "@/services/bookings";
import { getRememberedBookerName, rememberBookerName } from "@/lib/booking-name";

// Lazy so the month-grid picker only loads when "Pick dates" is chosen — keeps the
// form's initial render + LCP light (the whole form is already behind LazyBookingForm).
const MonthDatePicker = lazy(() => import("@/components/MonthDatePicker"));

// Cap on hand-picked dates (UI).
const MAX_PICK_DATES = 10;

// ── Server limits, mirrored ──────────────────────────────────────────────────
// These MUST stay in step with submit_booking_request (migration 20260831120000).
// Every picker is bounded by them so the form can never offer a date the submit
// would reject — a limit the user only discovers at submit time is a bug, not a
// guard rail. They apply to the PUBLIC request only: admin create/edit goes
// through create_approved_booking_series, which has no date bounds (an admin may
// legitimately record a session that already happened) and a 366-session cap.
const MAX_HORIZON_MONTHS = 18;
const MAX_PUBLIC_SESSIONS = 60;
const MAX_ADMIN_SESSIONS = 366;
const MAX_SESSION_DAYS = 7;
// Title and name (DB constraint + both RPCs agree on 100).
const TEXT_FIELD_MAX_CHARS = 100;
// Counters appear only once a field is within reach of its cap: a 20-character
// title needs no counter, but a paste silently truncated at 100 is a real surprise.
const COUNTER_VISIBLE_FROM = 80;
type DateMode = "recurring" | "pick";
// The user-facing dates choice: one three-way control over the two underlying
// flags. "single" = multiDates off; the other two = multiDates on.
type DatesMode = "single" | "repeat" | "pick";

// Which inline picker dropdown is open, if any.
type PickerKind = "date" | "repeatUntil" | "start" | "endDate" | "endTime" | "pickDates";

// Booking colours are assigned at random from this palette on create — the swatch
// picker was removed (bookers didn't use it), so a colour is now just calendar
// decoration. One colour per submission, so a whole weekly/multi-date series stays
// one colour (edits keep the existing colour untouched).
const BOOKING_COLORS: [number, number, number][] = [
  [180, 140, 200], [231, 111, 81], [233, 196, 84], [138, 154, 91],
  [70, 150, 158], [90, 100, 180], [217, 130, 165], [120, 85, 72],
];
const pickRandomColor = (): [number, number, number] => {
  const c = BOOKING_COLORS[Math.floor(Math.random() * BOOKING_COLORS.length)];
  return [c[0], c[1], c[2]];
};
const BOOKING_INFO_MAX_CHARS = 400;

interface Props {
  open: boolean;
  onClose: () => void;
  approvedBookings: Booking[];
  onSubmitted: (result: BookingFormSubmitResult) => void;
  editing?: Booking | null;
  adminMode?: boolean;
  ensureAdminSession?: () => Promise<boolean>;
}

// Monday-first display order for the weekly-day picker (JS getDay values).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

// Only "weekly" remains as a pattern — "daily" and "monthly" were retired
// (multi-date pick covers consecutive/sparse days; weekly is the one pattern that
// genuinely needs recurrence). The DB enum still accepts the old values for any
// legacy rows; the app just never creates them.
type Recurrence = "none" | "weekly";
// Turnstile sub-flow stages: loading (script) → challenge (widget shown) → verified
// (token in hand) → submitting → success | error.
type VerificationState = "loading" | "challenge" | "verified" | "submitting" | "success" | "error";
export type BookingFormSubmitResult =
  | { type: "created-approved"; bookings: Booking[] }
  | { type: "updated-approved"; bookings: Booking[] }
  | { type: "public-requested"; sessionCount: number };

// Best Practice: Explicitly define all error channels
type BookingFormErrors = Partial<Record<"title" | "name" | "info" | "date" | "startTime" | "endDate" | "endTime" | "recurrenceEnd" | "turnstile", string>>;
type BookingFormErrorKey = keyof BookingFormErrors;

export const BookingForm = ({ open, onClose, approvedBookings, onSubmitted, editing, adminMode = false, ensureAdminSession }: Props) => {
  const isEdit = !!editing;
  const { language, t } = useI18n();
  const { timeFormat } = usePreferences();
  const hour12 = timeFormat === "12h";
  const dateLocale = getDateLocale(language);
  // The earliest bookable moment, snapped to the 15-min grid. Note this can roll to
  // TOMORROW (after 23:45 there is no slot left today), which is why `earliestDay` — not
  // `today` — is the real floor for every date control. Otherwise the last 15 minutes of
  // the day offer a date whose every time is already past: an all-greyed time picker, or
  // (worse) a floor of "00:00" that greys nothing and only fails at submit.
  const nowFloor = snapUpTo15(new Date());
  const earliestDay = format(nowFloor, "yyyy-MM-dd", { locale: dateLocale });
  const earliestTime = format(nowFloor, "HH:mm", { locale: dateLocale });

  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [info, setInfo] = useState("");
  // First-render seed only — the open effect immediately replaces this with
  // nextAvailableSlot(). Seeding from the grid floor keeps that first frame valid and
  // 15-min aligned.
  const [date, setDate] = useState(earliestDay);
  const [startTime, setStartTime] = useState(earliestTime);
  const [useDuration, setUseDuration] = useState(true);
  const [durationH, setDurationH] = useState(2);

  const [endDate, setEndDate] = useState(earliestDay);
  const [endTime, setEndTime] = useState(earliestTime);
  const [userHasManuallyChangedEndDate, setUserHasManuallyChangedEndDate] = useState(false);

  const [rgb, setRgb] = useState<[number, number, number]>([180, 140, 200]);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [recurrenceEnd, setRecurrenceEnd] = useState("");
  // Weekly mode is day-of-week driven: the user picks a weekday (0=Sun..6=Sat, JS
  // getDay convention) instead of a start date; an effect below derives the anchor
  // date (the next occurrence of that weekday).
  const [weeklyDay, setWeeklyDay] = useState<number>(() => new Date().getDay());
  // Two-level multi-date control: single is the honest default — recurrence only
  // applies while multiDates is on.
  const [multiDates, setMultiDates] = useState(false);
  const [dateMode, setDateMode] = useState<DateMode>("recurring");
  const [pickedDates, setPickedDates] = useState<string[]>([]);
  // The approvedBookings prop only covers the window its page loaded (one week on
  // the public calendar), so the picker fetches each month it shows — otherwise other
  // months would look free when they aren't. Best-effort: a failed fetch just leaves
  // the client hint incomplete; the submit RPC's approved-overlap guard is authoritative.
  const [pickerMonthBookings, setPickerMonthBookings] = useState<Booking[]>([]);
  const fetchedPickerMonthsRef = useRef<Set<string>>(new Set());
  // Approved bookings covering the exact dates the current draft would submit. The
  // approvedBookings prop only spans the calendar's visible week, so without this a
  // slot booked in another week looks free here and only fails server-side (after a
  // wasted Turnstile challenge). Refetched as the draft's date span changes.
  const [targetedBookings, setTargetedBookings] = useState<Booking[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Guards the Turnstile callback against a double-fire (Cloudflare can re-invoke the
  // token callback), which would otherwise submit the same booking twice.
  const verifyInFlightRef = useRef(false);
  // Read-only review step: every create submission (public + admin) passes through
  // it before Turnstile/insert; edit skips it (one existing booking, nothing fans out).
  const [reviewOpen, setReviewOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>("loading");
  const [verificationError, setVerificationError] = useState("");
  const [verificationResetSignal, setVerificationResetSignal] = useState(0);
  const [errors, setErrors] = useState<BookingFormErrors>({});
  // Which inline picker dropdown is open (null = none).
  const [picker, setPicker] = useState<PickerKind | null>(null);
  // Shows the "next free slot was auto-selected" hint; cleared the moment the user
  // touches the start time, date, or duration (their intent replaces our guess).
  const [showAutoSlotHint, setShowAutoSlotHint] = useState(false);
  const formScrollRef = useRef<HTMLDivElement | null>(null);
  // Each picker field wraps its trigger in a `relative` box; the dropdown hangs off
  // that box and measures its room against it. One ref per field (only one dropdown
  // is ever open — `picker` is a single value).
  const conflictBannerRef = useRef<HTMLDivElement | null>(null);
  const dateAnchor = useRef<HTMLDivElement | null>(null);
  const repeatUntilAnchor = useRef<HTMLDivElement | null>(null);
  const startAnchor = useRef<HTMLDivElement | null>(null);
  const endDateAnchor = useRef<HTMLDivElement | null>(null);
  const endTimeAnchor = useRef<HTMLDivElement | null>(null);
  const pickDatesAnchor = useRef<HTMLDivElement | null>(null);
  // Keyed swap divs (mode switches) fade in on every SWAP, but enter at rest on the
  // form's opening render — the shell entrance owns that moment.
  const swapFadeReadyRef = useRef(false);
  useEffect(() => {
    swapFadeReadyRef.current = open;
  }, [open]);
  const swapFadeInitial = () => (swapFadeReadyRef.current ? { opacity: 0 } : false);
  const fieldRefs = useRef<Partial<Record<BookingFormErrorKey, HTMLElement | null>>>({});
  // Latest approved bookings without widening the open-effect deps — the effect seeds
  // the next-free slot from a snapshot at open; it must NOT re-run (and wipe the
  // user's draft) every time a realtime booking update arrives.
  const approvedBookingsRef = useRef(approvedBookings);
  useEffect(() => {
    approvedBookingsRef.current = approvedBookings;
  }, [approvedBookings]);
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const canCancelVerification = verificationState !== "verified" && verificationState !== "submitting" && verificationState !== "success";

  const setFieldRef = useCallback((key: BookingFormErrorKey) => (node: HTMLElement | null) => {
    fieldRefs.current[key] = node;
  }, []);

  // Pan to the first invalid field and focus it. The old FLIP pan is gone with the
  // inline panels — nothing else animates now, so a native smooth scroll on the body
  // is the whole gesture (browser-driven, no competing writer).
  const focusFirstInvalidField = useCallback((validationErrors: BookingFormErrors) => {
    // Visual (top-down) order — Days sits above the time fields, Info is last — so
    // "first invalid" is the VISUALLY topmost error.
    const fieldOrder: BookingFormErrorKey[] = ["title", "name", "date", "recurrenceEnd", "startTime", "endDate", "endTime", "info"];
    const firstInvalidKey = fieldOrder.find((key) => validationErrors[key]);
    if (!firstInvalidKey) return;
    const target = fieldRefs.current[firstInvalidKey];
    const container = formScrollRef.current;
    if (!target || !container) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const desiredTop = Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 24);
    container.scrollTo({ top: desiredTop, behavior: "smooth" });

    window.setTimeout(() => {
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    }, 160);
  }, []);

  // Tapping the header strip pans to the full banner — same maths as
  // focusFirstInvalidField, so there is one scroll behaviour in this form.
  const revealConflict = useCallback(() => {
    const target = conflictBannerRef.current;
    const container = formScrollRef.current;
    if (!target || !container) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const desiredTop = Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 24);
    container.scrollTo({ top: desiredTop, behavior: "smooth" });
  }, []);

  // A new STEP should start at its top, not inherit the previous step's offset.
  // Deliberately NOT keyed on `picker`: opening a dropdown must never scroll the
  // body, or the field you just tapped slides out from under your thumb — the exact
  // "everything moved" problem the overlay dropdown exists to prevent.
  useEffect(() => {
    formScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [reviewOpen, verificationOpen]);

  useEffect(() => {
    if (!open) {
      setReviewOpen(false);
      setVerificationOpen(false);
      setVerificationState("loading");
      setVerificationError("");
      setPicker(null);
      // Drop the picker's month cache so the next open refetches fresh availability.
      setPickerMonthBookings([]);
      setTargetedBookings([]);
      fetchedPickerMonthsRef.current.clear();
      return;
    }
    if (editing) {
      const s = new Date(editing.start_time);
      const e = new Date(editing.end_time);
      setTitle(editing.title);
      setName(editing.name);
      setInfo(editing.info ?? "");
      setDate(format(s, "yyyy-MM-dd", { locale: dateLocale }));
      setStartTime(format(s, "HH:mm", { locale: dateLocale }));
      setUseDuration(false);
      setEndDate(format(e, "yyyy-MM-dd", { locale: dateLocale }));
      setEndTime(format(e, "HH:mm", { locale: dateLocale }));
      setDurationH(Math.max(0.5, (e.getTime() - s.getTime()) / 3600000));
      setRgb([editing.color_r, editing.color_g, editing.color_b]);
      setRecurrence("none");
      setRecurrenceEnd("");
      setMultiDates(false);
      setDateMode("recurring");
      setPickedDates([]);
      setErrors({});
      setReviewOpen(false);
      setVerificationOpen(false);
      setVerificationState("loading");
      setVerificationError("");
      setUserHasManuallyChangedEndDate(true);
      setShowAutoSlotHint(false);
    } else {
      // Public repeat bookers get their last-used name prefilled (local only);
      // admin create starts blank since the admin is entering someone else's name.
      // Seed the next 15-min slot that DOESN'T already clash (2h default window), so
      // the form never opens on a taken time — and flag the hint to explain it.
      const seed = nextAvailableSlot(new Date(), approvedBookingsRef.current, 2 * 3_600_000);
      const seedDay = format(seed, "yyyy-MM-dd", { locale: dateLocale });
      const seedTime = format(seed, "HH:mm", { locale: dateLocale });
      setShowAutoSlotHint(true);
      setTitle(""); setName(adminMode ? "" : getRememberedBookerName()); setInfo(""); setDate(seedDay); setStartTime(seedTime);
      setUseDuration(true); setDurationH(2);
      setEndDate(seedDay); setEndTime(seedTime); // duration effect recomputes the real end
      setRgb(pickRandomColor()); setRecurrence("none"); setRecurrenceEnd("");
      setMultiDates(false); setDateMode("recurring"); setPickedDates([]);
      setReviewOpen(false);
      setVerificationOpen(false);
      setVerificationState("loading");
      setVerificationError("");
      setErrors({});
      setUserHasManuallyChangedEndDate(false);
    }
    // `today` is deliberately NOT a dep: it flips at midnight, and re-running this reset
    // while the form sits open would wipe an in-progress draft. The seeds inside read the
    // live clock at the moment the form opens, which is all that's needed.
  }, [open, editing, dateLocale, adminMode]);

  useEffect(() => {
    if (!date || !startTime) return;
    const currentStartDateTime = combineDateTime(date, startTime);
    if (isNaN(currentStartDateTime.getTime())) return;

    if (useDuration) {
      const calculatedEndDateTime = addHours(currentStartDateTime, durationH);
      if (isNaN(calculatedEndDateTime.getTime())) return;
      setEndDate(format(calculatedEndDateTime, "yyyy-MM-dd", { locale: dateLocale }));
      setEndTime(format(calculatedEndDateTime, "HH:mm", { locale: dateLocale }));
    } else {
      if (userHasManuallyChangedEndDate) return;

      const targetEndDateTimeToday = combineDateTime(date, endTime);
      if (isNaN(targetEndDateTimeToday.getTime())) return;

      if (isBefore(targetEndDateTimeToday, currentStartDateTime)) {
        const tomorrowDateString = format(addDays(currentStartDateTime, 1), "yyyy-MM-dd", { locale: dateLocale });
        setEndDate(tomorrowDateString);
      } else {
        setEndDate(date);
      }
    }
  }, [useDuration, date, startTime, durationH, endTime, userHasManuallyChangedEndDate, dateLocale]);

  useEffect(() => {
    if (useDuration) {
      setUserHasManuallyChangedEndDate(false);
    }
  }, [useDuration]);

  // Re-apply the start floor when the DATE changes. Keyed on the date TRANSITION,
  // not on the clock: re-clamping every tick would yank a chosen time out from under
  // someone mid-form as the floor advanced. Edit is exempt — an admin may legitimately
  // adjust a historical booking.
  const prevDateRef = useRef(date);
  useEffect(() => {
    if (prevDateRef.current === date) return;
    prevDateRef.current = date;
    if (isEdit || adminMode) return;
    const clamped = clampStartToFloor(startTime, date, earliestDay, earliestTime);
    if (clamped === startTime) return;
    setStartTime(clamped);
    setShowAutoSlotHint(false);
    setErrors((current) => ({ ...current, startTime: undefined, endTime: undefined }));
  }, [date, startTime, earliestDay, earliestTime, isEdit, adminMode]);

  const { start, end } = useMemo(() => {
    const s = combineDateTime(date, startTime);
    // In duration mode, derive end straight from the duration so start and end are ALWAYS
    // consistent within the same render. Reading endDate/endTime (which an effect updates
    // one render AFTER a start change) briefly pairs a new start with a stale end — a
    // huge/wrong span that flashed the conflict banner when toggling the time.
    const e = useDuration ? addHours(s, durationH) : combineDateTime(endDate, endTime);
    return { start: s, end: e };
  }, [date, startTime, endDate, endTime, useDuration, durationH]);

  // Pick-dates mode shares one time-of-day span (an interval) across every picked
  // date. We keep it as a duration so a cross-midnight booking rolls to the next day
  // correctly on each date, independent of the placeholder `date`.
  const sharedDurationMs = useMemo(() => end.getTime() - start.getTime(), [start, end]);

  // A picked date's shared slot; null when the time span is invalid.
  const slotForDate = useCallback((dayKey: string): { start: Date; end: Date } | null => {
    const slotStart = combineDateTime(dayKey, startTime);
    if (isNaN(slotStart.getTime()) || !(sharedDurationMs > 0)) return null;
    return { start: slotStart, end: new Date(slotStart.getTime() + sharedDurationMs) };
  }, [startTime, sharedDurationMs]);

  // Fetch approved bookings for whichever month the picker shows (once per month per
  // open). Failures are silent by design — see pickerMonthBookings above.
  const handlePickerMonthChange = useCallback(async (monthStart: Date) => {
    const key = format(monthStart, "yyyy-MM");
    if (fetchedPickerMonthsRef.current.has(key)) return;
    fetchedPickerMonthsRef.current.add(key);
    try {
      const rows = await loadApprovedBookingsForWindow({
        startTime: monthStart.getTime(),
        endTime: endOfMonth(monthStart).getTime(),
      });
      setPickerMonthBookings((current) => {
        const byId = new Map(current.map((b) => [b.id, b]));
        rows.forEach((b) => byId.set(b.id, b));
        return Array.from(byId.values());
      });
    } catch {
      // Allow a retry if the user navigates back to this month.
      fetchedPickerMonthsRef.current.delete(key);
    }
  }, []);

  // Availability = the page's visible-week prop + everything the month picker fetched
  // + the targeted fetch for the exact dates being submitted, deduped. This is what
  // the inline conflict guard checks against.
  const availabilityBookings = useMemo(() => {
    if (pickerMonthBookings.length === 0 && targetedBookings.length === 0) return approvedBookings;
    const byId = new Map(approvedBookings.map((b) => [b.id, b]));
    for (const b of pickerMonthBookings) if (!byId.has(b.id)) byId.set(b.id, b);
    for (const b of targetedBookings) if (!byId.has(b.id)) byId.set(b.id, b);
    return Array.from(byId.values());
  }, [approvedBookings, pickerMonthBookings, targetedBookings]);

  // Availability as numeric [start, end] spans, parsed ONCE per change instead of
  // once per comparison. See isDateUnavailable below for why that matters.
  const availabilitySpans = useMemo(
    () => availabilityBookings.map((b) => [new Date(b.start_time).getTime(), new Date(b.end_time).getTime()] as const),
    [availabilityBookings],
  );

  // Greys out days in the picker whose shared slot overlaps an approved booking.
  //
  // MEMOIZED PER DAY, deliberately: DayGrid asks about each cell THREE times per
  // render (isDisabled for the cell state, then dayLabel and dayClassName), and
  // re-seeding its roving tab stop asks about all 42 again. Uncached, one month
  // render was ~126 linear scans of the availability set — and that set GROWS as
  // the user navigates months (handlePickerMonthChange accumulates), so browsing
  // forward made every subsequent month-nav quadratically worse on exactly the
  // interaction that is already animating.
  //
  // The cache lives inside the memo, so its lifetime is exactly the validity of
  // its inputs: any change to the slot or the availability set builds a new
  // function with a new empty cache. There is no stale-entry path.
  const isDateUnavailable = useMemo(() => {
    const cache = new Map<string, boolean>();
    return (dayKey: string): boolean => {
      const cached = cache.get(dayKey);
      if (cached !== undefined) return cached;
      const slot = slotForDate(dayKey);
      let unavailable = false;
      if (slot) {
        const slotStart = slot.start.getTime();
        const slotEnd = slot.end.getTime();
        unavailable = availabilitySpans.some(([bStart, bEnd]) => overlapsMs(slotStart, slotEnd, bStart, bEnd));
      }
      cache.set(dayKey, unavailable);
      return unavailable;
    };
  }, [slotForDate, availabilitySpans]);

  const togglePickedDate = useCallback((dayKey: string) => {
    setPickedDates((current) => {
      if (current.includes(dayKey)) return current.filter((d) => d !== dayKey);
      if (current.length >= MAX_PICK_DATES) return current;
      return [...current, dayKey];
    });
    setErrors((current) => ({ ...current, date: undefined }));
  }, []);

  // Seed dates across modes so nothing feels reset: entering Pick dates pre-selects
  // the date already typed; leaving it folds the earliest picked date back into Date.
  const seedGridFromDateField = useCallback(() => {
    // The hidden Date field stays the time anchor in pick mode (it supplies the
    // shared time-of-day + duration) — if it was cleared, restore it to the earliest
    // bookable day so the anchor math never sees an invalid (or unbookable) date.
    if (!date) setDate(earliestDay);
    setPickedDates((current) => {
      if (current.length > 0) return current;
      return date && date >= earliestDay ? [date] : current;
    });
  }, [date, earliestDay]);

  const seedDateFieldFromGrid = useCallback(() => {
    const first = [...pickedDates].sort()[0];
    if (first) {
      setDate(first);
      setUserHasManuallyChangedEndDate(false);
    }
  }, [pickedDates]);

  // ── Dates mode ──────────────────────────────────────────────────────────────
  // ONE three-way control over the two underlying flags (`multiDates` + `dateMode`),
  // so validation, recurrence and submission read exactly what they always did.
  // Derived rather than stored, so the two can never drift.
  const datesMode: DatesMode = !multiDates ? "single" : dateMode === "pick" ? "pick" : "repeat";

  // One explicit transition per target: chaining two setters that each read
  // `dateMode` from their own closure would seed from a stale mode.
  const applyDatesMode = useCallback((next: DatesMode) => {
    setErrors((current) => ({ ...current, date: undefined, recurrenceEnd: undefined }));
    if (next === "single") {
      if (dateMode === "pick") seedDateFieldFromGrid();
      setMultiDates(false);
      setRecurrence("none");
      setRecurrenceEnd("");
      return;
    }
    const target: DateMode = next === "pick" ? "pick" : "recurring";
    setMultiDates(true);
    setDateMode(target);
    // Recurring means weekly (the only pattern); single IS the off state.
    setRecurrence((current) => (current === "none" ? "weekly" : current));
    if (target === "pick") {
      seedGridFromDateField();
    } else {
      // Weekly derives its anchor date from the weekday, so only the weekday needs
      // seeding — from the first picked date if any, else the date field.
      const firstPicked = [...pickedDates].sort()[0];
      const parsed = combineDateTime(firstPicked ?? date, "12:00");
      setWeeklyDay(isNaN(parsed.getTime()) ? new Date().getDay() : parsed.getDay());
    }
  }, [dateMode, seedDateFieldFromGrid, seedGridFromDateField, pickedDates, date]);

  // What actually applies at submit time — recurrence/pick only count while the
  // multi-dates switch is on (and never in edit mode).
  const isPickMode = !isEdit && multiDates && dateMode === "pick";
  const isWeeklyMode = !isEdit && multiDates && dateMode === "recurring";
  const effectiveRecurrence = isWeeklyMode ? recurrence : "none";

  // Weekly mode: the anchor date is DERIVED from the chosen weekday — the next
  // occurrence, counting today only while today's start time is still ahead.
  // Re-runs when the start time changes so an anchor set for "today 7pm" rolls to
  // next week if the user then picks a time that has already passed.
  useEffect(() => {
    if (!isWeeklyMode) return;
    const now = new Date();
    let offset = (weeklyDay - now.getDay() + 7) % 7;
    if (offset === 0 && startTime) {
      const todayStart = combineDateTime(format(now, "yyyy-MM-dd"), startTime);
      if (isNaN(todayStart.getTime()) || todayStart <= now) offset = 7;
    }
    setDate(format(addDays(now, offset), "yyyy-MM-dd"));
    setUserHasManuallyChangedEndDate(false);
  }, [isWeeklyMode, weeklyDay, startTime]);

  // Names the blocking booking with its title + when it actually runs (date + time),
  // so the booker sees exactly what they clash with, not just "on X".
  const describeConflict = useCallback((b: Booking) => t("bookingForm.conflict", {
    name: sanitizeDisplayText(b.title),
    date: fmtDate(new Date(b.start_time), language),
    time: formatClockRange(new Date(b.start_time), new Date(b.end_time), language),
  }), [t, language]);

  // The exact rows this submission will insert — the SAME builder used for the real
  // payload (submitPublicBookingRequest) and the review screen. Building the conflict
  // check from this means the client tests precisely what it sends.
  const submissionInstances = useMemo<BookingInstanceInput[]>(() => {
    if (!(end > start)) return [];
    // Pick mode with nothing chosen yet has no real rows — buildBookingRowsFromIntent
    // would otherwise fall through to the single anchor date.
    if (isPickMode && pickedDates.length === 0) return [];
    return buildBookingRowsFromIntent({
      start,
      end,
      recurrence: effectiveRecurrence,
      recurrenceEnd: effectiveRecurrence === "none" ? null : recurrenceEnd || null,
      customDates: isPickMode ? pickedDates : undefined,
    });
  }, [start, end, effectiveRecurrence, recurrenceEnd, isPickMode, pickedDates]);

  // The min→max instant the submission spans, used to fetch approved bookings for the
  // targeted dates (below) so the conflict check sees beyond the calendar's week.
  const submissionRange = useMemo(() => {
    if (submissionInstances.length === 0) return null;
    let from = Infinity;
    let to = -Infinity;
    for (const row of submissionInstances) {
      from = Math.min(from, new Date(row.start_time).getTime());
      to = Math.max(to, new Date(row.end_time).getTime());
    }
    return { from, to };
  }, [submissionInstances]);

  // Pull approved bookings covering the submission's date span so a slot booked in a
  // different week/month is caught by the inline guard here — instead of passing the
  // client check and only failing server-side after a wasted Turnstile challenge.
  const rangeFrom = submissionRange?.from;
  const rangeTo = submissionRange?.to;
  useEffect(() => {
    if (!open || rangeFrom === undefined || rangeTo === undefined) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const rows = await loadApprovedBookingsForWindow({
          startTime: rangeFrom,
          endTime: rangeTo,
          limit: 500,
        });
        if (!cancelled) setTargetedBookings(rows);
      } catch {
        // Leave the hint incomplete; the pre-submit recheck + server still guard it.
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, rangeFrom, rangeTo]);

  // The submission rows as numeric spans, parsed once (they're re-scanned against
  // every candidate booking below).
  const submissionSpans = useMemo(
    () => submissionInstances.map((row) => [new Date(row.start_time).getTime(), new Date(row.end_time).getTime()] as const),
    [submissionInstances],
  );

  // Reusable conflict check: the first submission instance that overlaps an approved
  // booking (skipping the row being edited) — or null if clear. Returns the BOOKING;
  // the message and the title are both derived from it below, so the two can't
  // describe different clashes.
  const findConflictBooking = useCallback((bookings: Booking[]): Booking | null => {
    if (submissionSpans.length === 0) return null;
    // Parse each candidate's bounds ONCE rather than once per submission row —
    // pick-dates mode scans up to MAX_PICK_DATES rows over the whole set.
    const candidates = bookings
      .filter((b) => !(editing && b.id === editing.id))
      .map((b) => ({ booking: b, start: new Date(b.start_time).getTime(), end: new Date(b.end_time).getTime() }));
    // Rows stay the OUTER loop: the conflict we report is the one blocking the
    // earliest session, which is the one the user is most likely looking at.
    for (const [start, end] of submissionSpans) {
      for (const candidate of candidates) {
        if (overlapsMs(start, end, candidate.start, candidate.end)) return candidate.booking;
      }
    }
    return null;
  }, [submissionSpans, editing]);

  const findConflict = useCallback((bookings: Booking[]): string | null => {
    const blocking = findConflictBooking(bookings);
    return blocking ? describeConflict(blocking) : null;
  }, [findConflictBooking, describeConflict]);

  const conflictBooking = useMemo(
    () => findConflictBooking(availabilityBookings),
    [findConflictBooking, availabilityBookings],
  );
  const conflict = useMemo(
    () => (conflictBooking ? describeConflict(conflictBooking) : null),
    [conflictBooking, describeConflict],
  );

  // A non-positive span builds NO submission rows, so findConflict has nothing to
  // test and reports "clear" — which also re-enabled Submit while the form was
  // unsubmittable, and made a real clash vanish from the UI. One value carries every
  // blocking problem so none of them can mask another.
  const blockingIssue = conflict ?? (end > start ? null : t("validation.endAfterStart"));

  // The blocking booking's title alone — the header strip has one truncated line, so
  // it names WHAT clashes and leaves the when to the full banner at the foot. Derived
  // from the same booking the message uses (this was a second, identical nested scan).
  const conflictTitle = useMemo(
    () => (conflictBooking ? sanitizeDisplayText(conflictBooking.title) : null),
    [conflictBooking],
  );

  const validate = () => {
    const nextErrors: BookingFormErrors = {};
    const cleanTitle = stripHtmlText(title).trim();
    const cleanName = stripHtmlText(name).trim();
    const cleanInfo = stripHtmlText(info).trim();
    if (!cleanTitle) nextErrors.title = t("validation.titleRequired");
    else if (cleanTitle.length > 100) nextErrors.title = t("validation.titleMax");
    if (!cleanName) nextErrors.name = t("validation.nameRequired");
    else if (cleanName.length > 100) nextErrors.name = t("validation.nameMax");
    if (cleanInfo.length > BOOKING_INFO_MAX_CHARS) nextErrors.info = t("validation.infoMax");
    // Links are blocked on the public request only (admin/edit are trusted). The
    // Edge Function re-checks server-side — this is the inline UX mirror. See
    // src/lib/text-guard.ts for why (Telegram auto-linkifies bare URLs/@handles).
    if (!adminMode && !isEdit) {
      if (!nextErrors.title && containsLink(cleanTitle)) nextErrors.title = t("validation.noLinks");
      if (!nextErrors.name && containsLink(cleanName)) nextErrors.name = t("validation.noLinks");
      if (!nextErrors.info && cleanInfo && containsLink(cleanInfo)) nextErrors.info = t("validation.noLinks");
    }
    if (!date) nextErrors.date = t("validation.dateRequired");
    if (!startTime) nextErrors.startTime = t("validation.startRequired");

    if (!useDuration) {
      if (!endDate) nextErrors.endDate = t("validation.dateRequired");
      if (!endTime) nextErrors.endTime = t("validation.endRequired");
    }
    if (!(end > start)) nextErrors.endTime = t("validation.endAfterStart");

    // The pickers only stop you SELECTING a past slot — a value can still go stale while
    // the form sits open (seed 18:00 at 17:58, submit at 18:23). Check the real rows we're
    // about to send, so single, weekly (first occurrence) and pick-dates are all covered.
    // Admin (create + edit) is exempt: their RPC accepts history, so this would be a
    // UI-only rule the server never enforces.
    if (!isEdit && !adminMode && submissionInstances.length > 0) {
      const earliest = Math.min(...submissionInstances.map((row) => new Date(row.start_time).getTime()));
      if (earliest < Date.now()) nextErrors.startTime = t("validation.startInPast");
    }

    if (isPickMode) {
      if (pickedDates.length < 1) nextErrors.date = t("bookingForm.pickAtLeastOne");
    } else if (effectiveRecurrence !== "none" && !recurrenceEnd) {
      nextErrors.recurrenceEnd = t("validation.repeatUntilRequired");
    }
    if (!isEdit && !adminMode && !turnstileSiteKey) {
      nextErrors.turnstile = t("bookingForm.verificationMissing");
    }
    setErrors(nextErrors);
    return nextErrors;
  };

  const submit = async () => {
    if (submitting) return;
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      focusFirstInvalidField(validationErrors);
      return;
    }
    if (conflict) {
      toast.error(conflict, { duration: 2000 });
      return;
    }
    // Edit saves directly (one existing booking); every create goes through review.
    if (isEdit && editing) {
      try {
        setSubmitting(true);
        // See confirmReview: ensureAdminSession toasts its own failures, but a
        // missing prop would otherwise no-op silently on "Save changes".
        if (!ensureAdminSession) {
          toast.error(t("bookingForm.failed"));
          return;
        }
        if (!(await ensureAdminSession())) return;
        const cleanTitle = stripHtmlText(title);
        const cleanName = stripHtmlText(name);
        const cleanInfo = stripHtmlText(info).trim() || null;
        const updated = await updateBooking({ id: editing.id, title: cleanTitle, name: cleanName, info: cleanInfo, start, end, rgb });
        toast.success(t("bookingForm.updated"));
        onSubmitted({ type: "updated-approved", bookings: [updated] }); onClose();
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, t("bookingForm.failed")), { duration: 3500 });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setReviewOpen(true);
  };

  // Confirm on the review screen: admin inserts now; public hands off to Turnstile.
  const confirmReview = async () => {
    if (submitting) return;
    try {
      if (adminMode) {
        setSubmitting(true);
        // Same strict gate as the edit path: a missing prop must FAIL closed, never
        // skip re-verification. RLS still enforces admin server-side — this is the
        // client half of that defence, and the two admin paths must not disagree.
        // ensureAdminSession toasts its own failures; the missing-prop branch is the
        // one path that would otherwise no-op silently on a button press.
        if (!ensureAdminSession) {
          toast.error(t("bookingForm.failed"));
          return;
        }
        if (!(await ensureAdminSession())) return;
        const cleanTitle = stripHtmlText(title);
        const cleanName = stripHtmlText(name);
        const cleanInfo = stripHtmlText(info).trim() || null;
        const created = await createApprovedAdminBookings({
          title: cleanTitle, name: cleanName, info: cleanInfo, start, end,
          recurrence: effectiveRecurrence,
          recurrenceEnd: effectiveRecurrence === "none" ? null : recurrenceEnd || null,
          customDates: isPickMode ? pickedDates : undefined,
          rgb,
        });
        toast.success(t("bookingForm.added"));
        onSubmitted({ type: "created-approved", bookings: created }); onClose(); return;
      }

      if (!turnstileSiteKey) {
        // validate() blocks this pre-review; guard again in case the env changed.
        setReviewOpen(false);
        setErrors((current) => ({ ...current, turnstile: t("bookingForm.verificationMissing") }));
        return;
      }
      setErrors((current) => ({ ...current, turnstile: undefined }));

      // Last responsible moment before spending a Turnstile challenge: re-check the
      // exact submission dates against a FRESH authoritative fetch. The slot may have
      // been approved since the form opened, and the calendar prop only covers one
      // week — so an out-of-week clash is caught here, before verification, not after.
      // On fetch failure we proceed: the server RPC still guards and the verification
      // catch surfaces a clean conflict message.
      if (submissionRange) {
        setSubmitting(true);
        try {
          const fresh = await loadApprovedBookingsForWindow({
            startTime: submissionRange.from,
            endTime: submissionRange.to,
            limit: 500,
          });
          setTargetedBookings(fresh);
          const freshConflict = findConflict(fresh);
          if (freshConflict) {
            setReviewOpen(false);
            toast.error(freshConflict, { duration: 3500 });
            return;
          }
        } catch {
          // Proceed to verification; server guard + catch path remain authoritative.
        }
      }

      setReviewOpen(false);
      setVerificationState("loading");
      setVerificationError("");
      setVerificationResetSignal((value) => value + 1);
      setVerificationOpen(true);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("bookingForm.failed")), { duration: 3500 });
    } finally {
      setSubmitting(false);
    }
  };

  const submitVerifiedPublicBooking = useCallback(async (turnstileToken: string) => {
    const cleanInfo = stripHtmlText(info).trim() || null;
    const result = await submitPublicBookingRequest({
      turnstileToken, title, name, info: cleanInfo, start, end,
      recurrence: effectiveRecurrence,
      recurrenceEnd: effectiveRecurrence === "none" ? null : recurrenceEnd || null,
      customDates: isPickMode ? pickedDates : undefined,
      rgb,
    });
    // Remember the name on this device so the next booking prefills it.
    rememberBookerName(stripHtmlText(name));
    toast.success(t("bookingForm.submitted", {
      count: result.sessionCount,
      sessions: result.sessionCount === 1 ? t("bookingForm.session") : t("bookingForm.sessions"),
    }));
    onSubmitted({ type: "public-requested", sessionCount: result.sessionCount });
  }, [end, info, title, name, onSubmitted, isPickMode, pickedDates, effectiveRecurrence, recurrenceEnd, rgb, start, t]);

  const resetVerification = useCallback((message: string) => {
    setVerificationError(message);
    setVerificationState("error");
    setVerificationResetSignal((value) => value + 1);
  }, []);

  const handleVerificationToken = useCallback(async (token: string) => {
    // verifyInFlightRef guards against Cloudflare double-firing the token callback,
    // which would submit the booking twice.
    if (!token || verifyInFlightRef.current) return;
    verifyInFlightRef.current = true;
    setVerificationError("");
    setVerificationState("verified");
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    setVerificationState("submitting");
    try {
      await submitVerifiedPublicBooking(token);
      setVerificationState("success");
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      setVerificationOpen(false);
      onClose();
    } catch (error: unknown) {
      const code = error instanceof BookingSubmitError ? error.code : "unknown";
      const message = getErrorMessage(error, t("turnstile.submitError"));
      if (code === "verification") {
        // A genuine challenge failure/expiry — reset the widget so they re-verify.
        resetVerification(message);
      } else {
        // Slot taken / rate limited / other: NOT a verification problem. Leave the
        // Turnstile step instead of re-challenging (re-challenging trapped users in a
        // fake "verification failed" loop for what was really a taken slot), drop back
        // to the form, refresh the availability hint so the inline banner shows the
        // clash, and explain what actually happened.
        setVerificationOpen(false);
        setVerificationState("loading");
        setVerificationError("");
        setVerificationResetSignal((value) => value + 1);
        if (code === "conflict" && submissionRange) {
          try {
            const fresh = await loadApprovedBookingsForWindow({
              startTime: submissionRange.from,
              endTime: submissionRange.to,
              limit: 500,
            });
            setTargetedBookings(fresh);
          } catch {
            // Banner stays as-is; the toast still explains the outcome.
          }
        }
        toast.error(message, { duration: 4000 });
      }
    } finally {
      verifyInFlightRef.current = false;
    }
  }, [onClose, resetVerification, submitVerifiedPublicBooking, t, submissionRange]);

  const closeVerificationStep = () => {
    if (!canCancelVerification) return;
    setVerificationOpen(false);
    setVerificationError("");
    setVerificationState("loading");
    setVerificationResetSignal((value) => value + 1);
  };

  // ── Picker bounds, derived from the server's own limits ─────────────────────
  // Admin paths are unbounded by date (their RPC allows history and a 2-year-plus
  // horizon), so these only pin the public request's pickers.
  const maxBookingDay = adminMode || isEdit
    ? undefined
    : format(addMonths(nowFloor, MAX_HORIZON_MONTHS), "yyyy-MM-dd", { locale: dateLocale });

  // For a weekly series the SESSION cap bites before the horizon does (60 weekly
  // occurrences is ~13.8 months), so Repeat-until stops at whichever comes first.
  const maxRepeatUntilDay = useMemo(() => {
    const anchor = combineDateTime(date, "12:00");
    if (isNaN(anchor.getTime())) return maxBookingDay;
    const cap = adminMode ? MAX_ADMIN_SESSIONS : MAX_PUBLIC_SESSIONS;
    // N occurrences means the anchor plus N-1 further weeks.
    const bySessions = format(addWeeks(anchor, cap - 1), "yyyy-MM-dd", { locale: dateLocale });
    if (!maxBookingDay) return bySessions;
    return bySessions > maxBookingDay ? maxBookingDay : bySessions;
  }, [date, adminMode, maxBookingDay, dateLocale]);

  // A single session can't outrun the server's span limit.
  const maxEndDay = useMemo(() => {
    if (adminMode || isEdit) return undefined;
    const anchor = combineDateTime(date, "12:00");
    if (isNaN(anchor.getTime())) return undefined;
    return format(addDays(anchor, MAX_SESSION_DAYS), "yyyy-MM-dd", { locale: dateLocale });
  }, [adminMode, isEdit, date, dateLocale]);

  // Start can't be before "now" once the chosen date IS the earliest bookable day.
  //
  // The END time deliberately has NO floor. Flooring it at the start time (which an
  // earlier revision did) silently killed cross-midnight bookings: the auto-roll effect
  // above turns "end earlier than start" into "end tomorrow" (22:00 → 01:00), and greying
  // out those earlier end times stops that from ever firing. `end > start` + the auto-roll
  // are the correct guards here, not a floor.
  // Admin is exempt for the same reason edit is: their RPC accepts historical
  // bookings, so flooring the picker was a UI-only restriction the server never
  // asked for — it forced "create then edit" just to log a session that happened.
  const startMinTime = !adminMode && date === earliestDay ? earliestTime : undefined;

  // The review step renders the EXACT rows the submission will send — these are the
  // same submissionInstances the conflict check runs on.
  const reviewRows = reviewOpen ? submissionInstances : [];

  // ── Value formatters for the picker rows ────────────────────────────────────
  const dateLabel = useCallback((value: string) => {
    if (!value) return t("bookingForm.selectDate");
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return t("bookingForm.selectDate");
    return formatLocalizedDate(d, language, "d MMM yyyy", "yyyy 年 M 月 d 日");
  }, [language, t]);

  const timeLabelFor = useCallback((hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    if (!Number.isFinite(h)) return "--";
    return formatClockTime(new Date(2000, 0, 1, h, Number.isFinite(m) ? m : 0), language, { hour12 });
  }, [language, hour12]);

  // ── Screens ─────────────────────────────────────────────────────────────────
  // Pickers are INLINE dropdowns (ui/picker-dropdown.tsx): the panel OVERLAYS the
  // fields below rather than pushing them, and nothing pans — so a field's label
  // stays put the whole time its picker is open.
  const closePicker = useCallback(() => setPicker(null), []);
  const togglePicker = useCallback((kind: PickerKind) => {
    setPicker((current) => (current === kind ? null : kind));
  }, []);

  // Every calendar confirms on its month-nav row: no bordered row of its own (worth
  // ~49px, the difference between the tallest panel fitting on a phone and being
  // clamped), and picking a day no longer dismisses — Done does. One rule for
  // single-date and multi-date alike.
  const gridDone = (
    <Button type="button" size="sm" onClick={closePicker} className="ml-1 h-8 gap-1 px-2.5">
      <Check className="h-3.5 w-3.5" aria-hidden />
      {t("common.done")}
    </Button>
  );

  // The wheel commits live as it settles, so this is a "done adjusting" affordance,
  // not a commit gate (an outside tap or Escape dismisses it just the same).
  const wheelDone = (
    <div className="mt-1.5 flex justify-end border-t border-border/60 pt-1.5">
      <Button type="button" size="sm" onClick={closePicker} className="gap-1.5">
        <Check className="h-4 w-4" aria-hidden />
        {t("common.done")}
      </Button>
    </div>
  );

  const formScreen: FormScreen = {
    key: "form",
    title: isEdit ? t("bookingForm.editTitle") : adminMode ? t("bookingForm.adminTitle") : t("bookingForm.requestTitle"),
    // Always-visible conflict cue. Lives in the header CHROME, so it neither covers
    // form content nor reflows it — a body-level banner would shove every field down
    // the moment a conflict appears, which happens live while dragging the duration
    // slider. One line, truncated; `role="alert"` stays on the full banner below so
    // screen readers announce the conflict once, not twice.
    banner: blockingIssue ? (
      <button
        type="button"
        onClick={revealConflict}
        aria-label={t("bookingForm.showConflict")}
        className="flex w-full items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-left text-xs text-destructive transition-colors duration-fast hover:bg-destructive/15 active:scale-[0.99] active:duration-tap"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {conflict && conflictTitle ? t("bookingForm.conflictShort", { name: conflictTitle }) : blockingIssue}
        </span>
      </button>
    ) : null,
    body: (
      // One label per control — no eyebrow group headers. A third text tier
      // competing with the field labels is what made this read busy.
      <div className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="title">{t("bookingForm.title")}</Label>
            {title.length >= COUNTER_VISIBLE_FROM && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("common.charCounter", { count: title.length, max: TEXT_FIELD_MAX_CHARS })}
              </span>
            )}
          </div>
          <Input
            id="title"
            ref={setFieldRef("title")}
            className="w-full min-w-0 max-w-full"
            placeholder={t("bookingForm.placeholder.title")}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
            maxLength={TEXT_FIELD_MAX_CHARS}
            aria-invalid={!!errors.title}
          />
          {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="name">{t("bookingForm.name")}</Label>
            {name.length >= COUNTER_VISIBLE_FROM && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("common.charCounter", { count: name.length, max: TEXT_FIELD_MAX_CHARS })}
              </span>
            )}
          </div>
          <Input
            id="name"
            ref={setFieldRef("name")}
            autoComplete="name"
            className="w-full min-w-0 max-w-full"
            placeholder={t("bookingForm.placeholder.name")}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
            maxLength={TEXT_FIELD_MAX_CHARS}
            aria-invalid={!!errors.name}
          />
          {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        </div>

        {/* ── Type ──
            ONE label for the single/weekly/multiple choice. This used to be a
            "When" group header PLUS a "Days" label PLUS the control — three
            labels for one decision, which is what made the form feel cluttered.
            Edit touches one existing booking, so there is nothing to fan out to. */}
        {!isEdit && (
          <div className="space-y-2">
            <span id="dates-mode-label" className="text-sm font-medium leading-none">{t("bookingForm.type")}</span>
            <SegmentedControl
              ariaLabelledBy="dates-mode-label"
              value={datesMode}
              onChange={applyDatesMode}
              options={[
                { value: "single", label: t("bookingForm.modeSingle") },
                { value: "repeat", label: t("bookingForm.modeRecurring") },
                { value: "pick", label: t("bookingForm.modePickDates") },
              ]}
            />
          </div>
        )}

        <motion.div
          key={datesMode}
          initial={swapFadeInitial()}
          animate={{ opacity: 1 }}
          transition={crossfadeTransition}
          className="space-y-5"
        >
          {datesMode === "single" && (
            <div className="space-y-1.5">
              <Label htmlFor="date">{t("bookingForm.date")}</Label>
              <div className="relative" ref={dateAnchor}>
                <FieldRow
                  id="date"
                  ref={setFieldRef("date")}
                  ariaLabel={t("bookingForm.date")}
                  icon={<CalendarIcon className="h-4 w-4" aria-hidden />}
                  value={dateLabel(date)}
                  placeholder={!date}
                  invalid={!!errors.date}
                  onClick={() => togglePicker("date")}
                />
                <PickerDropdown
                  open={picker === "date"}
                  onClose={closePicker}
                  anchorRef={dateAnchor}
                  ariaLabel={t("bookingForm.date")}
                >
                  <CalendarPanel
                    compact
                    value={date}
                    // Public bookings can't start in the past, and can't outrun the
                    // server's horizon. Admin/edit keep neither bound — their RPC
                    // accepts history and a far longer horizon.
                    min={isEdit || adminMode ? undefined : earliestDay}
                    max={maxBookingDay}
                    // Days whose slot already clashes are struck through + unselectable,
                    // the same language the pick-dates grid uses.
                    isUnavailable={isEdit ? undefined : isDateUnavailable}
                    headerTrailing={gridDone}
                    onChange={(v) => {
                      setDate(v);
                      setShowAutoSlotHint(false);
                      setErrors((current) => ({ ...current, date: undefined, endTime: undefined }));
                    }}
                  />
                </PickerDropdown>
              </div>
              {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
            </div>
          )}

          {datesMode === "repeat" && (
            <>
              <div className="min-w-0 space-y-1.5">
                <span id="weekly-day-label" className="text-sm font-medium leading-none">{t("bookingForm.weeklyDay")}</span>
                {/* Seven tap-a-day buttons (3-letter), wrapping 4+3 on mobile and
                    7-across from sm up — easier than a dropdown for one weekday. */}
                <div role="group" aria-labelledby="weekly-day-label" className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                  {WEEKDAY_ORDER.map((day) => {
                    // 2026-06-07 is a Sunday; +day lands on that weekday.
                    const sample = addDays(new Date(2026, 5, 7), day);
                    const selected = weeklyDay === day;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setWeeklyDay(day)}
                        aria-pressed={selected}
                        aria-label={format(sample, "EEEE", { locale: dateLocale })}
                        className={cn(
                          "min-h-11 rounded-md border px-1 text-sm font-medium tabular-nums transition-colors duration-fast",
                          selected
                            ? "border-interactive-border bg-interactive text-interactive-text shadow-sm dark:shadow-none"
                            : "border-border bg-card text-muted-foreground hover:bg-muted active:scale-[0.97] active:duration-tap",
                        )}
                      >
                        {format(sample, "EEE", { locale: dateLocale })}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="rend">{t("bookingForm.repeatUntil")}</Label>
                <div className="relative" ref={repeatUntilAnchor}>
                  <FieldRow
                    id="rend"
                    ref={setFieldRef("recurrenceEnd")}
                    ariaLabel={t("bookingForm.repeatUntil")}
                    icon={<CalendarIcon className="h-4 w-4" aria-hidden />}
                    value={dateLabel(recurrenceEnd)}
                    placeholder={!recurrenceEnd}
                    invalid={!!errors.recurrenceEnd}
                    onClick={() => togglePicker("repeatUntil")}
                  />
                  <PickerDropdown
                    open={picker === "repeatUntil"}
                    onClose={closePicker}
                    anchorRef={repeatUntilAnchor}
                    ariaLabel={t("bookingForm.repeatUntil")}
                  >
                    <CalendarPanel
                      compact
                      value={recurrenceEnd}
                      // The series can't end before its first occurrence (`date` is the
                      // derived weekly anchor, always today or later) — nor run past
                      // the session cap / horizon, whichever comes first.
                      min={date}
                      max={maxRepeatUntilDay}
                      headerTrailing={gridDone}
                      onChange={(v) => {
                        setRecurrenceEnd(v);
                        setErrors((current) => ({ ...current, recurrenceEnd: undefined }));
                      }}
                    />
                  </PickerDropdown>
                </div>
                {errors.recurrenceEnd && <p className="text-xs text-destructive">{errors.recurrenceEnd}</p>}
                <p className="text-xs text-muted-foreground">{t("bookingForm.weeklyRepeatHint")}</p>
                {/* Named up front, because the Repeat-until calendar simply stops at
                    the cap — an unexplained wall is worse than a stated limit. */}
                <p className="text-xs text-muted-foreground">
                  {t("bookingForm.weeklyRepeatCapHint", { max: adminMode ? MAX_ADMIN_SESSIONS : MAX_PUBLIC_SESSIONS })}
                </p>
              </div>
            </>
          )}

          {datesMode === "pick" && (
            <div className="space-y-1.5">
              <Label htmlFor="pick-dates">{t("bookingForm.datesSelected")}</Label>
              <div className="relative" ref={pickDatesAnchor}>
                <FieldRow
                  id="pick-dates"
                  ref={setFieldRef("date")}
                  ariaLabel={t("bookingForm.modePickDates")}
                  icon={<CalendarIcon className="h-4 w-4" aria-hidden />}
                  value={
                    pickedDates.length
                      ? t("bookingForm.datesChosen", { count: pickedDates.length, max: MAX_PICK_DATES })
                      : t("bookingForm.pickAtLeastOne")
                  }
                  placeholder={pickedDates.length === 0}
                  invalid={!!errors.date}
                  onClick={() => togglePicker("pickDates")}
                />
                <PickerDropdown
                  open={picker === "pickDates"}
                  onClose={closePicker}
                  anchorRef={pickDatesAnchor}
                  ariaLabel={t("bookingForm.modePickDates")}
                >
                  <Suspense
                    fallback={
                      <div className="grid min-h-[17.5rem] place-items-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    <MonthDatePicker
                      compact
                      headerTrailing={gridDone}
                      selected={pickedDates}
                      onToggle={togglePickedDate}
                      max={MAX_PICK_DATES}
                      isUnavailable={isDateUnavailable}
                      minDate={earliestDay}
                      maxDate={maxBookingDay}
                      onMonthChange={handlePickerMonthChange}
                    />
                  </Suspense>
                </PickerDropdown>
              </div>
              {/* Chips live BESIDE the field, not inside the dropdown: they grow with
                  each pick (up to MAX_PICK_DATES, wrapping over rows), and that
                  unbounded growth is what forced the panel to scroll. The form body
                  may scroll; a picker never should. */}
              {pickedDates.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[...pickedDates].sort().map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => togglePickedDate(key)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-2 text-xs font-medium text-foreground transition-colors hover:bg-muted active:scale-[0.97] active:duration-tap"
                      aria-label={t("bookingForm.removeDate", { date: format(new Date(`${key}T00:00:00`), "MMM d", { locale: dateLocale }) })}
                    >
                      <span className="tabular-nums">{format(new Date(`${key}T00:00:00`), "MMM d", { locale: dateLocale })}</span>
                      <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </button>
                  ))}
                </div>
              )}
              {/* Sets the expectation the review step fulfils: one shared time. */}
              <p className="text-xs text-muted-foreground">{t("bookingForm.pickSharedTimeHint")}</p>
              {/* Only once it actually bites — a cap you're nowhere near is noise,
                  but hitting one with no explanation is worse. */}
              {pickedDates.length >= MAX_PICK_DATES && (
                <p className="text-xs text-muted-foreground">
                  {t("bookingForm.datesAtCap", { max: MAX_PICK_DATES })}
                </p>
              )}
              {errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
            </div>
          )}
        </motion.div>

        {/* ── Start time ── */}
        <div className="space-y-1.5">
          <Label htmlFor="start">{t("bookingForm.startTime")}</Label>
          <div className="relative" ref={startAnchor}>
            <FieldRow
              id="start"
              ref={setFieldRef("startTime")}
              ariaLabel={t("bookingForm.startTime")}
              icon={<Clock className="h-4 w-4" aria-hidden />}
              value={timeLabelFor(startTime)}
              invalid={!!errors.startTime}
              onClick={() => togglePicker("start")}
            />
            <PickerDropdown
              open={picker === "start"}
              onClose={closePicker}
              anchorRef={startAnchor}
              ariaLabel={t("bookingForm.startTime")}
            >
              <TimeWheel
                size="compact"
                value={startTime}
                minTime={startMinTime}
                onChange={(v) => {
                  setStartTime(v);
                  setShowAutoSlotHint(false);
                  setErrors((current) => ({ ...current, startTime: undefined, endTime: undefined }));
                }}
              />
              {wheelDone}
            </PickerDropdown>
          </div>
          {showAutoSlotHint && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3 w-3 shrink-0" aria-hidden />
              {t("bookingForm.autoSlotHint")}
            </p>
          )}
          {errors.startTime && <p className="text-xs text-destructive">{errors.startTime}</p>}
        </div>

        {/* ── Ends ── a two-way segmented control naming both options, unboxed. */}
        <div className="space-y-2">
          <span id="end-mode-label" className="text-sm font-medium leading-none">{t("bookingForm.end")}</span>
          <SegmentedControl
            ariaLabelledBy="end-mode-label"
            value={useDuration ? "duration" : "endtime"}
            onChange={(next) => {
              setUseDuration(next === "duration");
              setShowAutoSlotHint(false);
            }}
            options={[
              { value: "duration", label: t("bookingForm.modeDuration") },
              { value: "endtime", label: t("bookingForm.modeEndTime") },
            ]}
          />
          <motion.div
            key={useDuration ? "duration" : "endtime"}
            initial={swapFadeInitial()}
            animate={{ opacity: 1 }}
            transition={crossfadeTransition}
            className="space-y-2 pt-1"
          >
            {useDuration ? (
              <>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 text-muted-foreground">{t("bookingForm.duration")}</span>
                  <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 font-medium tabular-nums">{durationH.toFixed(1)} h</span>
                </div>
                <Slider
                  min={0.5}
                  max={8}
                  step={0.5}
                  value={[durationH]}
                  onValueChange={(v) => {
                    setDurationH(v[0]);
                    setShowAutoSlotHint(false);
                    setErrors((current) => ({ ...current, endTime: undefined }));
                  }}
                />
                {errors.endTime && <p className="text-xs text-destructive">{errors.endTime}</p>}
              </>
            ) : (
              <div className="space-y-3">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="endDate">{t("bookingForm.endDate")}</Label>
                  <div className="relative" ref={endDateAnchor}>
                    <FieldRow
                      id="endDate"
                      ref={setFieldRef("endDate")}
                      ariaLabel={t("bookingForm.endDate")}
                      icon={<CalendarIcon className="h-4 w-4" aria-hidden />}
                      value={dateLabel(endDate)}
                      placeholder={!endDate}
                      invalid={!!errors.endDate}
                      onClick={() => togglePicker("endDate")}
                    />
                    <PickerDropdown
                      open={picker === "endDate"}
                      onClose={closePicker}
                      anchorRef={endDateAnchor}
                      ariaLabel={t("bookingForm.endDate")}
                    >
                      <CalendarPanel
                        compact
                        value={endDate}
                        // A booking can't end before it starts (and `date` is itself
                        // floored to today for new bookings, so this blocks past dates),
                        // nor run longer than the server's single-session span limit.
                        min={date}
                        max={maxEndDay}
                        headerTrailing={gridDone}
                        onChange={(v) => {
                          setEndDate(v);
                          setUserHasManuallyChangedEndDate(true);
                          setErrors((current) => ({ ...current, endDate: undefined }));
                        }}
                      />
                    </PickerDropdown>
                  </div>
                  {errors.endDate && <p className="text-xs text-destructive">{errors.endDate}</p>}
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="end">{t("bookingForm.endTime")}</Label>
                  <div className="relative" ref={endTimeAnchor}>
                    <FieldRow
                      id="end"
                      ref={setFieldRef("endTime")}
                      ariaLabel={t("bookingForm.endTime")}
                      icon={<Clock className="h-4 w-4" aria-hidden />}
                      value={timeLabelFor(endTime)}
                      invalid={!!errors.endTime}
                      onClick={() => togglePicker("endTime")}
                    />
                    <PickerDropdown
                      open={picker === "endTime"}
                      onClose={closePicker}
                      anchorRef={endTimeAnchor}
                      ariaLabel={t("bookingForm.endTime")}
                    >
                      {/* The END time deliberately has NO floor — see startMinTime. */}
                      <TimeWheel
                        size="compact"
                        value={endTime}
                        onChange={(v) => {
                          setEndTime(v);
                          setErrors((current) => ({ ...current, endTime: undefined }));
                        }}
                      />
                      {wheelDone}
                    </PickerDropdown>
                  </div>
                  {errors.endTime && <p className="text-xs text-destructive">{errors.endTime}</p>}
                </div>
              </div>
            )}
          </motion.div>
        </div>

        {/* ── Notes ── */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="booking-info">{t("bookingForm.info")}</Label>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t("common.charCounter", { count: info.length, max: BOOKING_INFO_MAX_CHARS })}
            </span>
          </div>
          <Textarea
            id="booking-info"
            ref={setFieldRef("info")}
            className="h-52 resize-none"
            value={info}
            onChange={(e) => {
              setInfo(e.target.value);
              setErrors((current) => ({ ...current, info: undefined }));
            }}
            maxLength={BOOKING_INFO_MAX_CHARS}
            placeholder={t("bookingForm.infoPlaceholder")}
            aria-invalid={!!errors.info}
            aria-describedby={errors.info ? "booking-info-error" : undefined}
          />
          {errors.info && <p id="booking-info-error" className="text-xs text-destructive">{errors.info}</p>}
        </div>

        {/* Conflict warning sits below every scheduling input (days + time — its
            cause) and stays visible the whole time the conflict exists — the submit
            button is disabled while it shows, so it must not fade out on its own. */}
        {blockingIssue && (
          <div
            key={blockingIssue}
            ref={conflictBannerRef}
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{blockingIssue}</span>
          </div>
        )}

        {!isEdit && !adminMode && errors.turnstile && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors.turnstile}
          </div>
        )}
      </div>
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>{t("common.cancel")}</Button>
        <Button onClick={submit} disabled={submitting || !!blockingIssue}>
          {submitting ? t("bookingForm.saving") : isEdit ? t("bookingForm.saveChanges") : t("bookingForm.review")}
        </Button>
      </>
    ),
  };
  const reviewScreen: FormScreen = {
    key: "review",
    title: t("bookingForm.reviewTitle"),
    onBack: () => setReviewOpen(false),
    body: (
      <BookingReviewStep
        title={title}
        name={name}
        info={info}
        rows={reviewRows}
        recurrence={effectiveRecurrence}
        rgb={rgb}
        adminMode={adminMode}
      />
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={() => setReviewOpen(false)} disabled={submitting}>
          {t("common.back")}
        </Button>
        <Button onClick={confirmReview} disabled={submitting}>
          {submitting ? t("bookingForm.saving") : adminMode ? t("bookingForm.confirm") : t("bookingForm.confirmSubmit")}
        </Button>
      </>
    ),
  };

  const verificationScreen: FormScreen = {
    key: "verification",
    // NOT turnstile.title — that string says "Step 2", which is right for
    // AdminAuthMenu's two-step dialog but wrong here (this is the third screen).
    title: t("bookingForm.verifyTitle"),
    // Once the token is in hand and we're submitting, nothing may dismiss this.
    dismissable: canCancelVerification,
    onBack: closeVerificationStep,
    body: (
      <BookingVerificationStep
        siteKey={turnstileSiteKey}
        state={verificationState}
        error={verificationError}
        resetSignal={verificationResetSignal}
        onToken={handleVerificationToken}
        onExpired={() => resetVerification(t("turnstile.expired"))}
        onError={() => resetVerification(t("turnstile.loadFailed"))}
        onReady={() => setVerificationState((current) => current === "loading" ? "challenge" : current)}
      />
    ),
    footer: (
      <Button type="button" variant="ghost" onClick={closeVerificationStep} disabled={!canCancelVerification}>
        {t("common.cancel")}
      </Button>
    ),
  };

  const stack: FormScreen[] = [formScreen];
  if (reviewOpen) stack.push(reviewScreen);
  if (verificationOpen) stack.push(verificationScreen);

  return (
    <FormShell
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (verificationOpen && !canCancelVerification) return;
        onClose();
      }}
      stack={stack}
      bodyRef={formScrollRef}
    />
  );
};

// ── Review step ──────────────────────────────────────────────────────────────
// Read-only confirmation before every create (DESIGN_SYSTEM → Confirmation screen).
// One skeleton for all three modes, with an ADAPTIVE hero — the session count for a
// series, the date for a single booking — then the WHEN, then title/booker/notes,
// then the full date grid for a series.
// The rows come from buildBookingRowsFromIntent (what you see is what's inserted).
// Times render via formatClockRange (the single 24h/12h authority in lib/date).
const BookingReviewStep = ({
  title,
  name,
  info,
  rows,
  recurrence,
  rgb,
  adminMode,
}: {
  title: string;
  name: string;
  info: string;
  rows: BookingInstanceInput[];
  recurrence: BookingRecurrence;
  rgb: [number, number, number];
  adminMode: boolean;
}) => {
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);
  const isPattern = recurrence !== "none";
  const isSeries = isPattern || rows.length > 1;
  const first = rows.length ? new Date(rows[0].start_time) : null;
  const timeLabel = rows.length
    ? formatClockRange(new Date(rows[0].start_time), new Date(rows[0].end_time), language)
    : "";
  // A lone booking that crosses midnight can't be shown as "date + time range" —
  // that drops the end date. Show the full span instead.
  const singleMultiDay =
    !isPattern &&
    rows.length === 1 &&
    isMultiDay(new Date(rows[0].start_time), new Date(rows[0].end_time));
  const cleanInfo = sanitizeDisplayText(info).trim();

  // Every session shares one length, so this is stated ONCE beside the time rather
  // than repeated per row. It appears nowhere else in the flow.
  const hours = rows.length
    ? (new Date(rows[0].end_time).getTime() - new Date(rows[0].start_time).getTime()) / 3_600_000
    : 0;
  const durationLabel = hours > 0
    ? t("bookingForm.durationValue", { hours: Number.isInteger(hours) ? hours : hours.toFixed(1) })
    : "";

  // Chronological rows grouped by calendar month → "August 2026" header + its days.
  const monthGroups = useMemo(() => {
    const groups: { key: string; label: string; days: Date[] }[] = [];
    rows.forEach((row) => {
      const day = new Date(row.start_time);
      const key = format(day, "yyyy-MM");
      const group = groups.find((g) => g.key === key);
      if (group) group.days.push(day);
      else groups.push({ key, label: formatLocalizedDate(day, language, "MMMM yyyy", "yyyy 年 M 月"), days: [day] });
    });
    return groups;
  }, [rows, language]);

  // The booking's own colour, so the art means something and varies per booking.
  // Used ONLY as a small solid accent and as the date-chip tint — never as text,
  // never behind text, and no large wash: with 8 random colours across light AND
  // dark, a big field of colour reads as a placeholder rather than a design, and
  // anything type-bearing would be a contrast lottery.
  const tint = (alpha: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  const solid = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

  // A series leads with how many sessions it creates; a single booking leads with
  // its date — in each case the number most worth sanity-checking.
  const heroNumber = isSeries ? String(rows.length) : first ? format(first, "d", { locale: dateLocale }) : "—";

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-[1.25rem] border border-border bg-muted/30 px-5 py-6">
        <div className="relative">
          {/* Top row: the weekday leads, the status pill closes it out.
              The pill used to be absolutely positioned in this corner, which was
              fine while the hero left the space empty — but the weekday now sits
              here too, and "Wednesday" beside "Pending admin review" overlapped on
              a narrow phone. In flow they simply share the row and self-size, in
              any language, with no magic offsets. */}
          <div className="flex items-start justify-between gap-3">
            {/* Weekday. Reads DOWN the block as a natural date: Thursday / 21 /
                August 2026. It is also the token that most often catches a
                mis-picked date — people know practice is on a Thursday. */}
            {!isSeries && first ? (
              <p className="text-xl font-semibold leading-tight text-foreground">
                {format(first, "EEEE", { locale: dateLocale })}
              </p>
            ) : (
              <span />
            )}
            {/* Muted, dot-led and unobtrusive rather than a coloured alert: it is
                context, not a warning. */}
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 py-1 text-[0.7rem] font-medium text-muted-foreground">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {adminMode ? t("bookingForm.nextImmediate") : t("bookingForm.nextPending")}
            </span>
          </div>

          {/* Hero type. The oversized size + tight tracking is the sanctioned
              editorial exception (DESIGN_SYSTEM → Confirmation screen), the same
              licence ConsentGate's title takes. Outfit, never Fraunces. */}
          <p className="mt-1 text-[clamp(3.75rem,22vw,5.5rem)] font-bold leading-[0.85] tracking-[-0.04em] tabular-nums text-foreground">
            {heroNumber}
          </p>

          {isSeries ? (
            <p className="mt-2 text-base font-semibold uppercase tracking-[0.08em] text-foreground">
              {rows.length === 1 ? t("bookingForm.session") : t("bookingForm.sessions")}
            </p>
          ) : first ? (
            // Month AND year share the weekday's exact style — one colour, one
            // weight, one size. Dimming the year and muting the weekday split a
            // single fact across three treatments and made none of them read
            // clearly; hierarchy here comes from the hero's SIZE alone.
            <p className="mt-2 text-xl font-semibold leading-tight text-foreground">
              {formatLocalizedDate(first, language, "MMMM", "M 月")}{" "}
              <span className="tabular-nums">{format(first, "yyyy")}</span>
            </p>
          ) : null}

          {/* The one place the colour appears at full strength. */}
          <div aria-hidden className="mt-4 h-1 w-12 rounded-full" style={{ backgroundColor: solid }} />

          {/* The WHEN, stated exactly once. A weekly booking needs its pattern named
              (not derivable from the date chips at a glance); a multi-date one does
              not, and previously printed its time twice. */}
          <div className="mt-4 space-y-1">
            {isPattern && first && (
              <p className="text-lg font-semibold text-foreground">
                {t("common.everyDay", { day: format(first, "EEEE", { locale: dateLocale }) })}
              </p>
            )}
            {singleMultiDay && first ? (
              <p className="text-lg font-semibold tabular-nums text-foreground break-words">
                {fmtBookingSpan(first, new Date(rows[0].end_time), language)}
              </p>
            ) : (
              <p className={cn("font-semibold tabular-nums text-foreground", isPattern ? "text-lg" : "text-2xl")}>
                {timeLabel}
              </p>
            )}
            {durationLabel && (
              <p className="text-sm tabular-nums text-muted-foreground">{durationLabel}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Who + what ── */}
      <div className="space-y-1 px-0.5">
        <p className="type-item-title break-words text-foreground">{sanitizeDisplayText(title)}</p>
        <p className="text-sm text-muted-foreground break-words">{sanitizeDisplayText(name)}</p>
        {cleanInfo && (
          <p className="pt-1 text-xs text-muted-foreground break-words line-clamp-3">{cleanInfo}</p>
        )}
      </div>

      {/* ── Every date, so the booker can verify what is actually being created ──
          Circles echo the accent's shape language. No date-range summary line: the
          month headers plus the chips already state the span, so a range would be
          repeating what is directly below it. */}
      {isSeries && (
        <div className="space-y-3 px-0.5">
          <p className="type-eyebrow text-muted-foreground">{t("bookingForm.reviewDates")}</p>
          {monthGroups.map((group) => (
            <div key={group.key}>
              <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.days.map((day) => (
                  <span
                    key={day.toISOString()}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold tabular-nums text-foreground"
                    style={{ backgroundColor: tint(0.16) }}
                  >
                    {format(day, "d", { locale: dateLocale })}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const BookingVerificationStep = ({
  siteKey,
  state,
  error,
  resetSignal,
  onToken,
  onExpired,
  onError,
  onReady,
}: {
  siteKey?: string;
  state: VerificationState;
  error: string;
  resetSignal: number;
  onToken: (token: string) => void;
  onExpired: () => void;
  onError: () => void;
  onReady: () => void;
}) => {
  const { t } = useI18n();
  const statusText = (() => {
    if (state === "loading") return t("turnstile.loading");
    if (state === "verified") return t("turnstile.verified");
    if (state === "submitting") return t("turnstile.submitting");
    if (state === "success") return t("turnstile.success");
    if (state === "error") return t("turnstile.retry");
    return t("turnstile.challenge");
  })();
  const helperText = (() => {
    if (state === "loading") return t("turnstile.waiting");
    if (state === "verified") return t("turnstile.verifying");
    if (state === "submitting") return t("turnstile.submittingDescription");
    if (state === "success") return t("turnstile.successDescription");
    if (state === "error") return error;
    return t("turnstile.challengeDescription");
  })();

  return (
    <>
      {/* The ONE announcement channel for this screen. It lives outside the branch
          below so it is never unmounted: screen readers reliably announce changes
          WITHIN an existing live region, but a freshly-mounted one is hit-and-miss —
          and the branch swaps its whole subtree on every state change. Without this,
          a blind user tapped Confirm, heard nothing at all, and the dialog closed.
          The visible copies are aria-hidden so nothing is announced twice. */}
      <p role="status" aria-live="polite" className="sr-only">
        {statusText} {helperText}
      </p>
      {(state === "verified" || state === "submitting" || state === "success") ? (
        <div className="grid min-h-[9rem] place-items-center p-4 text-center">
          <div className="space-y-2">
            {state === "submitting" ? (
              <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
            ) : (
              <CheckCircle2 className="mx-auto h-9 w-9 text-primary" />
            )}
            <div aria-hidden>
              <p className="text-sm font-semibold">{statusText}</p>
              <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-[9rem] place-items-center p-1">
          <div className="w-full space-y-3">
            {state === "loading" && (
              // Reserves exactly what the widget will occupy once it renders, so the
              // swap is seamless. 390px is MEDIA.xsDown — the same breakpoint
              // TurnstileWidget uses to pick `compact` (~140px) over `flexible`
              // (~65px). Keep the two in step.
              <div className="grid min-h-[65px] max-[390px]:min-h-[140px] place-items-center text-center">
                <div className="space-y-2">
                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" />
                  <p aria-hidden className="text-sm font-medium">{statusText}</p>
                </div>
              </div>
            )}
            {siteKey && (
              <div className={state === "loading" ? "h-0 overflow-hidden" : undefined}>
                <TurnstileWidget
                  siteKey={siteKey}
                  onTokenChange={onToken}
                  onExpired={onExpired}
                  onError={onError}
                  onReady={onReady}
                  resetSignal={resetSignal}
                />
              </div>
            )}
            <p
              aria-hidden
              className={`text-center text-xs ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {helperText}
            </p>
          </div>
        </div>
      )}
    </>
  );
};
