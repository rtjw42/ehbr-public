// ── Event form ───────────────────────────────────────────────────────────────
// Admin dialog to create/edit an event's BASICS (title, location, date, poster,
// description). Media + setlist live on the event detail page (MediaSetlistForm).
//
// Rendered through <FormShell> as a stack of screens (see DESIGN_SYSTEM → Form
// System), the same system BookingForm uses: the frame never resizes, the keyboard
// translates the sheet rather than shrinking it, and Back pops a screen instead of
// closing the form. Admin-only, so there is no review step and no Turnstile —
// just the form screen, plus a crop screen while a poster is being adjusted.
//
// Date/start/end are FieldRow + PickerDropdown (CalendarPanel / TimeWheel) — the
// same dropdown pickers as the booking form. No date/time floor: events can be in
// the past, so CalendarPanel gets no `min`. End time is optional behind an
// "Add end time" reveal (the wheel has no empty state).
//
// ── Poster uploads are DEFERRED to save ──────────────────────────────────────
// The crop produces a Blob that is held in state and previewed from an object URL;
// the bytes only reach storage inside handleSave. Uploading at crop time orphaned a
// bucket object on every cancel or re-crop; deferring also lets a failed upload be
// retried with the form intact, and it saves a second ensureAdminSession round-trip.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { FormShell, type FormScreen } from "@/components/ui/form-shell";
import { FormField } from "@/components/ui/form-field";
import { FieldRow } from "@/components/ui/field-row";
import { PickerDropdown } from "@/components/ui/picker-dropdown";
import { UploadField } from "@/components/ui/upload-field";
import { CalendarPanel } from "@/components/ui/calendar-panel";
import { TimeWheel } from "@/components/ui/time-wheel";
import { toast } from "sonner";
import { Calendar as CalendarIcon, Check, Clock, Loader2, Plus, X, ZoomIn, ZoomOut } from "lucide-react";
import { EventItem } from "@/lib/events";
import { format } from "date-fns";
import { getErrorMessage } from "@/lib/errors";
import { assertEventPosterBytes, fileValidationTranslationKey, MAX_EVENT_POSTER_BYTES } from "@/lib/file-validation";
import { CropError, cropToJpegBlob, MAX_ZOOM, MIN_ZOOM, type CropArea } from "@/lib/image-crop";
import { saveEvent, uploadEventPoster } from "@/services/events";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { usePreferences } from "@/hooks/usePreferences";
import { useInvalidFieldFocus } from "@/hooks/useInvalidFieldFocus";
import { formatClockTime, formatLocalizedDate, getDateLocale } from "@/lib/date";

// react-easy-crop is heavy and only reached when an admin adjusts a poster.
const ImageCropperStage = lazy(() => import("@/components/ImageCropperStage"));

const EVENT_DESCRIPTION_MAX_CHARS = 400;

// Seed for the "Add end time" reveal: start + 2h, snapped inside the same day so a
// late start never seeds a wrap-around end (the wheel is a 15-min grid, so keep :mm).
const seedEndTime = (start: string) => {
  const [h, m] = start.split(":").map(Number);
  const endH = (Number.isFinite(h) ? h : 19) + 2;
  const mm = String(Number.isFinite(m) ? m : 0).padStart(2, "0");
  return endH >= 24 ? "23:45" : `${String(endH).padStart(2, "0")}:${mm}`;
};

// The poster is either what's already persisted, or a freshly cropped blob waiting
// for save. Keeping them distinct is what lets save know whether it must upload.
type PosterState =
  | { kind: "existing"; url: string }
  | { kind: "new"; blob: Blob; previewUrl: string }
  | null;

const posterPreviewSrc = (poster: PosterState) =>
  poster === null ? null : poster.kind === "existing" ? poster.url : poster.previewUrl;

const CENTERED_CROP = { x: 0, y: 0 };

type PickerKind = "date" | "start" | "end" | null;

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: EventItem | null;
  onSaved: () => void;
}

type EventFormErrors = {
  title?: string;
  description?: string;
  eventDate?: string;
  eventTime?: string;
  poster?: string;
};
type EventFormErrorKey = keyof EventFormErrors;
// Visual top-down order. `poster` is deliberately absent: handleSave never sets a
// poster error (an upload failure is a toast), and a pick-time one appears while
// the user is already looking at that field.
const FIELD_ORDER: readonly EventFormErrorKey[] = ["title", "eventDate", "eventTime", "description"];

export const EventForm = ({ open, onClose, editing, onSaved }: Props) => {
  const { ensureAdminSession } = useAdmin();
  const { language, t } = useI18n();
  const { timeFormat } = usePreferences();
  const hour12 = timeFormat === "12h";
  const dateLocale = getDateLocale(language);

  const [errors, setErrors] = useState<EventFormErrors>({});
  // A refused save scrolls to the first bad field and focuses it — the shared
  // behaviour (DESIGN_SYSTEM -> Form System -> Failure behaviour), not this form's
  // own.
  const { setFieldRef, focusFirstInvalidField } = useInvalidFieldFocus<EventFormErrorKey>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("19:00");
  const [endTime, setEndTime] = useState("");
  const [showEndTime, setShowEndTime] = useState(false);
  const [poster, setPoster] = useState<PosterState>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<PickerKind>(null);

  // ── Crop screen state ───────────────────────────────────────────────────────
  // Reset on every open. The old cropper stayed mounted between images, so a second
  // photo inherited the first one's zoom and offset — and `area` was briefly the
  // PREVIOUS image's coordinates until react-easy-crop reported a new one.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState(CENTERED_CROP);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [cropping, setCropping] = useState(false);

  const dateAnchor = useRef<HTMLDivElement>(null);
  const startAnchor = useRef<HTMLDivElement>(null);
  const endAnchor = useRef<HTMLDivElement>(null);

  // Object URLs are process-wide; the browser will not reclaim one just because the
  // state holding it was replaced. Revoke through a ref so both the replace path and
  // unmount go through the same place.
  const previewUrlRef = useRef<string | null>(null);
  const setPosterTracked = useCallback((next: PosterState) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next?.kind === "new" ? next.previewUrl : null;
    setPoster(next);
  }, []);
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }, []);

  // useLayoutEffect, NOT useEffect. The host keeps this component mounted and only
  // flips `open`, so every field still holds the PREVIOUS session's values when the
  // form reopens. With a passive effect React paints those stale values first and
  // resets them a frame later — you saw the last event's title and poster flash
  // behind the opening sheet. A layout effect runs before paint, so the reset lands
  // in the same frame and the stale state is never visible.
  useLayoutEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setLocation(editing.location ?? "");
      const ed = new Date(editing.event_date);
      setEventDate(format(ed, "yyyy-MM-dd", { locale: dateLocale }));
      setEventTime(format(ed, "HH:mm", { locale: dateLocale }));
      setEndTime(editing.end_date ? format(new Date(editing.end_date), "HH:mm", { locale: dateLocale }) : "");
      setShowEndTime(!!editing.end_date);
      setPosterTracked(editing.poster_url ? { kind: "existing", url: editing.poster_url } : null);
    } else {
      setTitle(""); setDescription(""); setLocation("");
      setEventDate(format(new Date(), "yyyy-MM-dd", { locale: dateLocale }));
      setEventTime("19:00"); setEndTime(""); setShowEndTime(false);
      setPosterTracked(null);
    }
    setErrors({});
    setPicker(null);
    setCropSrc(null);
    // Cleared here rather than in handleSave's success path — see the note there.
    setSaving(false);
  }, [open, editing, dateLocale, setPosterTracked]);

  // ── Value formatters for the picker rows ────────────────────────────────────
  const dateLabel = useCallback((value: string) => {
    if (!value) return t("eventForm.selectDate");
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return t("eventForm.selectDate");
    return formatLocalizedDate(d, language, "d MMM yyyy", "yyyy 年 M 月 d 日");
  }, [language, t]);

  const timeLabelFor = useCallback((hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    if (!Number.isFinite(h)) return "--";
    return formatClockTime(new Date(2000, 0, 1, h, Number.isFinite(m) ? m : 0), language, { hour12 });
  }, [language, hour12]);

  const closePicker = useCallback(() => setPicker(null), []);
  const togglePicker = useCallback((kind: Exclude<PickerKind, null>) => {
    setPicker((current) => (current === kind ? null : kind));
  }, []);

  // ── Crop flow ───────────────────────────────────────────────────────────────
  const openCropper = (src: string) => {
    setCrop(CENTERED_CROP);
    setZoom(MIN_ZOOM);
    setCropArea(null);
    setCropSrc(src);
  };

  // Async because the gate now proves the file's type from its BYTES rather than
  // trusting `file.type` (which the browser derives from the extension). An
  // unsupported file is refused here, before the cropper opens.
  const handleFilePicked = async (file: File) => {
    try {
      await assertEventPosterBytes(file);
      setErrors((current) => ({ ...current, poster: undefined }));
    } catch (error: unknown) {
      const validationKey = fileValidationTranslationKey(error);
      setErrors((current) => ({ ...current, poster: validationKey ? t(validationKey) : getErrorMessage(error, t("validation.fileInvalid")) }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => openCropper(reader.result as string);
    reader.onerror = () => toast.error(t("imageCropper.decodeFailed"));
    reader.readAsDataURL(file);
  };

  // Re-open the cropper on the CURRENT poster. A not-yet-uploaded blob is re-read
  // locally; only an already-persisted poster costs a network round-trip.
  const recropPoster = async () => {
    if (!poster) return;
    try {
      const blob = poster.kind === "new"
        ? poster.blob
        : await (await fetch(poster.url)).blob();
      const reader = new FileReader();
      reader.onload = () => openCropper(reader.result as string);
      reader.onerror = () => toast.error(t("eventForm.cropLoadFailed"));
      reader.readAsDataURL(blob);
    } catch {
      toast.error(t("eventForm.cropLoadFailed"));
    }
  };

  const applyCrop = async () => {
    if (!cropSrc || !cropArea || cropping) return;
    setCropping(true);
    try {
      const blob = await cropToJpegBlob(cropSrc, cropArea, { maxBytes: MAX_EVENT_POSTER_BYTES });
      setPosterTracked({ kind: "new", blob, previewUrl: URL.createObjectURL(blob) });
      setErrors((current) => ({ ...current, poster: undefined }));
      setCropSrc(null);
    } catch (error: unknown) {
      // `decode` is the realistic one: an iPhone HEIC passes the `image/*` gate on
      // the way in but will not decode outside Safari.
      toast.error(
        error instanceof CropError && error.reason === "decode"
          ? t("imageCropper.decodeFailed")
          : t("imageCropper.cropFailed"),
      );
    } finally {
      setCropping(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const nextErrors = {
      title: title.trim() ? undefined : t("validation.titleRequired"),
      description: description.length <= EVENT_DESCRIPTION_MAX_CHARS ? undefined : t("validation.descriptionMax"),
      eventDate: eventDate ? undefined : t("validation.dateRequired"),
      eventTime: eventTime ? undefined : t("validation.startRequired"),
    };
    const merged = { ...errors, ...nextErrors };
    setErrors(merged);
    if (nextErrors.title || nextErrors.description || nextErrors.eventDate || nextErrors.eventTime) {
      focusFirstInvalidField(merged, FIELD_ORDER);
      return;
    }
    // `saving` goes up BEFORE the session check, not after. verifyLiveAdminSession
    // is a network round-trip; on a phone that is a visible pause during which the
    // button showed no spinner AND — because `saving` was still false — the `if
    // (saving) return` guard did not hold, so a second tap started a second save.
    // On a create that is two events.
    setSaving(true);
    try {
      if (!(await ensureAdminSession())) {
        setSaving(false);
        return;
      }
      // The only moment poster bytes reach storage. A failure here leaves the form
      // — and the cropped blob — exactly as they were, so Save can just be retried.
      // Caught separately so the toast says "could not upload" rather than blaming
      // the save, which never ran.
      let posterUrl: string | null = null;
      if (poster?.kind === "existing") posterUrl = poster.url;
      if (poster?.kind === "new") {
        try {
          const { publicUrl } = await uploadEventPoster(poster.blob);
          posterUrl = publicUrl;
        } catch (error: unknown) {
          toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("eventForm.uploadFailed")));
          setSaving(false);
          return;
        }
      }

      await saveEvent({
        editingId: editing?.id,
        draft: { title, description, location, eventDate, eventTime, endTime, posterUrl },
      });
      toast.success(editing ? t("eventForm.eventUpdated") : t("eventForm.eventCreated"));
      // Closing is the host's, through onSaved — the same as every other form.
      onSaved();
      // `saving` is deliberately NOT cleared on the success path. The sheet is
      // exit-animating from here, and repainting the footer back to its idle label
      // mid-exit is the flicker that read as the button reverting to an old state.
      // The open reset clears it instead, so a reopened form never starts disabled.
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("eventForm.saveFailed")));
      setSaving(false);
    }
  };

  // Every calendar in the app confirms on its month-nav row rather than dismissing
  // on pick — one rule for single-date and multi-date alike (DESIGN_SYSTEM → Form
  // System → Pickers). Same affordance BookingForm uses.
  const gridDone = (
    <Button type="button" size="sm" onClick={closePicker} className="ml-1 h-8 gap-1 px-2.5">
      <Check className="h-3.5 w-3.5" aria-hidden />
      {t("common.done")}
    </Button>
  );

  // Picker "Done" — the wheel commits live, so this dismisses rather than confirms.
  const wheelDone = (
    <div className="mt-1.5 flex justify-end border-t border-border/60 pt-1.5">
      <Button type="button" size="sm" onClick={closePicker} className="gap-1.5">
        <Check className="h-4 w-4" aria-hidden />
        {t("common.done")}
      </Button>
    </div>
  );

  const previewSrc = posterPreviewSrc(poster);

  // ── Form screen ─────────────────────────────────────────────────────────────
  const formScreen: FormScreen = {
    key: "form",
    title: editing ? t("eventForm.editTitle") : t("eventForm.newTitle"),
    body: (
      <div className="space-y-5">
        <FormField id="ev-title" label={t("eventForm.title")} error={errors.title}>
          <Input
            id="ev-title"
            ref={setFieldRef("title")}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
            maxLength={255}
            placeholder={t("eventForm.placeholder.title")}
            aria-invalid={!!errors.title}
          />
        </FormField>

        <FormField id="ev-loc" label={t("eventForm.location")}>
          <Input
            id="ev-loc"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={255}
            placeholder={t("eventForm.placeholder.location")}
          />
        </FormField>

        {/* ── Date ── no `min`: events may be in the past. */}
        <FormField id="ev-date" label={t("eventForm.date")} error={errors.eventDate}>
          <div className="relative" ref={dateAnchor}>
            <FieldRow
              id="ev-date"
              ref={setFieldRef("eventDate")}
              ariaLabel={t("eventForm.date")}
              icon={<CalendarIcon className="h-4 w-4" aria-hidden />}
              value={dateLabel(eventDate)}
              placeholder={!eventDate}
              invalid={!!errors.eventDate}
              onClick={() => togglePicker("date")}
            />
            <PickerDropdown
              open={picker === "date"}
              onClose={closePicker}
              anchorRef={dateAnchor}
              ariaLabel={t("eventForm.date")}
            >
              <CalendarPanel
                compact
                value={eventDate}
                headerTrailing={gridDone}
                onChange={(v) => {
                  setEventDate(v);
                  setErrors((current) => ({ ...current, eventDate: undefined }));
                }}
              />
            </PickerDropdown>
          </div>
        </FormField>

        {/* ── Start time ── */}
        <FormField id="ev-start" label={t("eventForm.start")} error={errors.eventTime}>
          <div className="relative" ref={startAnchor}>
            <FieldRow
              id="ev-start"
              ref={setFieldRef("eventTime")}
              ariaLabel={t("eventForm.start")}
              icon={<Clock className="h-4 w-4" aria-hidden />}
              value={timeLabelFor(eventTime)}
              invalid={!!errors.eventTime}
              onClick={() => togglePicker("start")}
            />
            <PickerDropdown
              open={picker === "start"}
              onClose={closePicker}
              anchorRef={startAnchor}
              ariaLabel={t("eventForm.start")}
            >
              <TimeWheel
                size="compact"
                value={eventTime}
                onChange={(v) => {
                  setEventTime(v);
                  setErrors((current) => ({ ...current, eventTime: undefined }));
                }}
              />
              {wheelDone}
            </PickerDropdown>
          </div>
        </FormField>

        {/* ── End time (optional) ── */}
        {showEndTime ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ev-end">{t("eventForm.endOptional")}</Label>
              {/* `-m-2 p-2` grows the touch target to ~36px without moving the text
                  — a bare 16px line of `text-xs` is a poor tap target on a phone. */}
              <button
                type="button"
                onClick={() => { setShowEndTime(false); setEndTime(""); closePicker(); }}
                className="-m-2 shrink-0 rounded-md p-2 text-xs text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]"
              >
                {t("eventForm.removeEndTime")}
              </button>
            </div>
            <div className="relative" ref={endAnchor}>
              <FieldRow
                id="ev-end"
                ariaLabel={t("eventForm.endOptional")}
                icon={<Clock className="h-4 w-4" aria-hidden />}
                value={timeLabelFor(endTime || eventTime)}
                onClick={() => togglePicker("end")}
              />
              <PickerDropdown
                open={picker === "end"}
                onClose={closePicker}
                anchorRef={endAnchor}
                ariaLabel={t("eventForm.endOptional")}
              >
                <TimeWheel
                  size="compact"
                  value={endTime || eventTime}
                  minTime={eventTime}
                  onChange={setEndTime}
                />
                {wheelDone}
              </PickerDropdown>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setEndTime(seedEndTime(eventTime)); setShowEndTime(true); }}
            className="-m-2 inline-flex min-h-11 items-center gap-1.5 rounded-md p-2 text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)]"
          >
            <Plus className="h-4 w-4" /> {t("eventForm.addEndTime")}
          </button>
        )}

        <FormField
          id="ev-desc"
          label={t("eventForm.description")}
          labelTrailing={t("common.charCounter", { count: description.length, max: EVENT_DESCRIPTION_MAX_CHARS })}
          error={errors.description}
        >
          <Textarea
            id="ev-desc"
            ref={setFieldRef("description")}
            className="h-36 resize-none"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setErrors((current) => ({ ...current, description: undefined }));
            }}
            maxLength={EVENT_DESCRIPTION_MAX_CHARS}
            placeholder={t("eventForm.placeholder.description")}
            aria-invalid={!!errors.description}
          />
        </FormField>

        {/* ── Poster ── the preview is local until save; nothing is uploaded yet.
            The dropzone and the preview now share ONE fixed `h-64` box (UploadField),
            so adding or removing a poster no longer resizes the form — the old
            `py-8` dropzone grew to a 16rem preview on every pick. */}
        <FormField id="ev-poster" label={t("eventForm.posterImage")} error={errors.poster}>
          <UploadField
            id="ev-poster"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onPick={handleFilePicked}
            prompt={t("eventForm.clickToUploadPoster")}
            filled={previewSrc ? { src: previewSrc, name: t("eventForm.posterPreview") } : null}
            // Posters are square by the time they land here, so filling the box
            // trims nothing.
            fit="cover"
            actions={
              <>
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-full px-3 shadow-sm" onClick={recropPoster}>
                  {t("eventForm.adjust")}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-full shadow-sm"
                  onClick={() => setPosterTracked(null)}
                  aria-label={t("eventForm.removePoster")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            }
            className="h-64 w-full"
            invalid={!!errors.poster}
          />
        </FormField>
      </div>
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? t("eventForm.saveChanges") : t("eventForm.createEvent")}
        </Button>
      </>
    ),
  };

  // ── Crop screen ─────────────────────────────────────────────────────────────
  // A pushed screen, not a nested dialog: Back pops it, and an outside tap can no
  // longer dismiss it — which silently discarded the crop in the old host.
  const moved = crop.x !== CENTERED_CROP.x || crop.y !== CENTERED_CROP.y || zoom !== MIN_ZOOM;
  const stepZoom = (delta: number) =>
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(2)))));

  const cropScreen: FormScreen | null = cropSrc ? {
    key: "crop",
    title: t("imageCropper.title"),
    onBack: () => setCropSrc(null),
    body: (
      <div className="space-y-4">
        <Suspense
          fallback={<div className="mx-auto aspect-square w-full max-w-[26rem] animate-pulse rounded-[var(--radius-lg)] bg-secondary" />}
        >
          <ImageCropperStage
            imageSrc={cropSrc}
            crop={crop}
            zoom={zoom}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onAreaChange={setCropArea}
          />
        </Suspense>

        {/* Zoom row. The old control was a bare uppercase <label> (which named
            nothing — no htmlFor) above a naked slider. The icons are real tap
            targets, so touch isn't limited to a pinch gesture. */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={() => stepZoom(-0.25)}
            disabled={zoom <= MIN_ZOOM}
            aria-label={t("imageCropper.zoomOut")}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Slider
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={[zoom]}
            onValueChange={(v) => setZoom(v[0])}
            aria-label={t("imageCropper.zoom")}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0 rounded-full"
            onClick={() => stepZoom(0.25)}
            disabled={zoom >= MAX_ZOOM}
            aria-label={t("imageCropper.zoomIn")}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-muted-foreground">{t("imageCropper.hint")}</p>
          <button
            type="button"
            onClick={() => { setCrop(CENTERED_CROP); setZoom(MIN_ZOOM); }}
            disabled={!moved}
            className="-m-2 shrink-0 rounded-md p-2 text-xs text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--foreground)/0.1)] disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            {t("imageCropper.reset")}
          </button>
        </div>
      </div>
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={() => setCropSrc(null)} disabled={cropping}>
          {t("common.back")}
        </Button>
        {/* Disabled until react-easy-crop reports an area — which is genuinely not
            ready until the image has decoded, so this is honest rather than the
            "broken for a frame" state it looks like. Without it the button is live
            while applyCrop can only no-op, which is the same silent-nothing this
            rewrite set out to remove. */}
        <Button onClick={applyCrop} disabled={cropping || !cropArea}>
          {cropping && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("imageCropper.usePhoto")}
        </Button>
      </>
    ),
  } : null;

  const stack = cropScreen ? [formScreen, cropScreen] : [formScreen];

  return (
    <FormShell
      open={open}
      // Guarded HERE rather than via the screen's `dismissable` flag: that flag also
      // controls whether FormShell renders the close button and reserves the title's
      // right padding, so toggling it on `saving` made the header visibly jump the
      // instant Create was pressed. This blocks the close without touching layout.
      onOpenChange={(next) => {
        if (next || saving) return;
        onClose();
      }}
      stack={stack}
    />
  );
};
