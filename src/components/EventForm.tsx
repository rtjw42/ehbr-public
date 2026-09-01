// ── Event form ───────────────────────────────────────────────────────────────
// Admin dialog to create/edit an event's BASICS (title, location, date, poster,
// description). Media + setlist live on the event detail page (MediaSetlistEditor).
// Poster flow: pick image → lazy-loaded ImageCropper squares it → uploadEventPoster
// pushes the JPEG through the upload-admin-file Edge Function. Writes go through the
// events service after the admin session is re-verified.
// Date/start/end use the shared FLIP pickers (DateField/TimeSelect) — the DialogBody is
// wrapped in <FlipScope> so they pan+expand like the booking form. End time is optional
// via an "Add end time" reveal (TimeSelect has no empty state). No date/time floor —
// events can be in the past.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/DateField";
import { TimeSelect } from "@/components/TimeSelect";
import { FlipScope } from "@/components/ui/flip-scope";
import { toast } from "sonner";
import { Loader2, Plus, Upload, X } from "lucide-react";
import { EventItem } from "@/lib/events";
import { format } from "date-fns";
import { getErrorMessage } from "@/lib/errors";
import { assertEventPosterFile, fileValidationTranslationKey } from "@/lib/file-validation";
import { saveEvent, uploadEventPoster } from "@/services/events";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { getDateLocale } from "@/lib/date";

const ImageCropper = lazy(() => import("@/components/ImageCropper").then((module) => ({ default: module.ImageCropper })));
const EVENT_DESCRIPTION_MAX_CHARS = 400;

// Seed for the "Add end time" reveal: start + 2h, snapped inside the same day so a
// late start never seeds a wrap-around end (TimeSelect is 15-min grid, so keep :mm).
const seedEndTime = (start: string) => {
  const [h, m] = start.split(":").map(Number);
  const endH = (Number.isFinite(h) ? h : 19) + 2;
  const mm = String(Number.isFinite(m) ? m : 0).padStart(2, "0");
  return endH >= 24 ? "23:45" : `${String(endH).padStart(2, "0")}:${mm}`;
};

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: EventItem | null;
  onSaved: () => void;
}

export const EventForm = ({ open, onClose, editing, onSaved }: Props) => {
  const { ensureAdminSession } = useAdmin();
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);
  const [errors, setErrors] = useState<{ title?: string; description?: string; eventDate?: string; eventTime?: string; poster?: string }>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("19:00");
  const [endTime, setEndTime] = useState("");
  const [showEndTime, setShowEndTime] = useState(false);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
      setPosterUrl(editing.poster_url);
    } else {
      setTitle(""); setDescription(""); setLocation("");
      setEventDate(format(new Date(), "yyyy-MM-dd", { locale: dateLocale }));
      setEventTime("19:00"); setEndTime(""); setShowEndTime(false); setPosterUrl(null);
    }
    setErrors({});
  }, [open, editing, dateLocale]);

  const handleFilePicked = (file: File) => {
    try {
      assertEventPosterFile(file);
      setErrors((current) => ({ ...current, poster: undefined }));
    } catch (error: unknown) {
      const validationKey = fileValidationTranslationKey(error);
      setErrors((current) => ({ ...current, poster: validationKey ? t(validationKey) : getErrorMessage(error, t("validation.fileInvalid")) }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadBlob = async (blob: Blob) => {
    if (uploading) return;
    if (!(await ensureAdminSession())) return;
    setUploading(true);
    try {
      const { publicUrl } = await uploadEventPoster(blob);
      setPosterUrl(publicUrl);
      toast.success(t("eventForm.posterSaved"));
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("eventForm.uploadFailed")));
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const recropExisting = async () => {
    if (!posterUrl) return;
    try {
      const res = await fetch(posterUrl);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => setCropSrc(reader.result as string);
      reader.readAsDataURL(blob);
    } catch {
      toast.error(t("eventForm.cropLoadFailed"));
    }
  };

  const handleSave = async () => {
    if (saving || uploading) return;
    const nextErrors = {
      title: title.trim() ? undefined : t("validation.titleRequired"),
      description: description.length <= EVENT_DESCRIPTION_MAX_CHARS ? undefined : t("validation.descriptionMax"),
      eventDate: eventDate ? undefined : t("validation.dateRequired"),
      eventTime: eventTime ? undefined : t("validation.startRequired"),
    };
    setErrors((current) => ({ ...current, ...nextErrors }));
    if (nextErrors.title || nextErrors.description || nextErrors.eventDate || nextErrors.eventTime) {
      return;
    }
    if (!(await ensureAdminSession())) return;
    setSaving(true);
    try {
      await saveEvent({
        editingId: editing?.id,
        draft: { title, description, location, eventDate, eventTime, endTime, posterUrl },
      });
      toast.success(editing ? t("eventForm.eventUpdated") : t("eventForm.eventCreated"));
      onSaved();
      onClose();
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("eventForm.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {editing ? t("eventForm.editTitle") : t("eventForm.newTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogBody scrollRef={scrollRef}>
          <FlipScope scrollerRef={scrollRef}>
          <div className="space-y-4">
          <div>
            <Label htmlFor="ev-title">{t("eventForm.title")}</Label>
            <Input
              id="ev-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErrors((current) => ({ ...current, title: undefined }));
              }}
              maxLength={255}
              placeholder={t("eventForm.placeholder.title")}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? "ev-title-error" : undefined}
            />
            {errors.title && <p id="ev-title-error" className="text-xs text-destructive">{errors.title}</p>}
          </div>
          <div>
            <Label htmlFor="ev-loc">{t("eventForm.location")}</Label>
            <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={255} placeholder={t("eventForm.placeholder.location")} />
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ev-date">{t("eventForm.date")}</Label>
              <DateField
                id="ev-date"
                value={eventDate}
                onChange={(v) => {
                  setEventDate(v);
                  setErrors((current) => ({ ...current, eventDate: undefined }));
                }}
                ariaInvalid={!!errors.eventDate}
              />
              {errors.eventDate && <p id="ev-date-error" className="text-xs text-destructive">{errors.eventDate}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ev-start">{t("eventForm.start")}</Label>
              <TimeSelect
                id="ev-start"
                value={eventTime}
                onChange={(v) => {
                  setEventTime(v);
                  setErrors((current) => ({ ...current, eventTime: undefined }));
                }}
                ariaInvalid={!!errors.eventTime}
              />
              {errors.eventTime && <p id="ev-start-error" className="text-xs text-destructive">{errors.eventTime}</p>}
            </div>
            {showEndTime ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="ev-end">{t("eventForm.endOptional")}</Label>
                  <button
                    type="button"
                    onClick={() => { setShowEndTime(false); setEndTime(""); }}
                    className="text-xs text-muted-foreground transition-colors duration-fast hover:text-foreground"
                  >
                    {t("eventForm.removeEndTime")}
                  </button>
                </div>
                <TimeSelect id="ev-end" value={endTime || eventTime} onChange={setEndTime} minTime={eventTime} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setEndTime(seedEndTime(eventTime)); setShowEndTime(true); }}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-fast hover:text-foreground"
              >
                <Plus className="h-4 w-4" /> {t("eventForm.addEndTime")}
              </button>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ev-desc">{t("eventForm.description")}</Label>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("common.charCounter", { count: description.length, max: EVENT_DESCRIPTION_MAX_CHARS })}
              </span>
            </div>
            <Textarea
              id="ev-desc"
              className="mt-1 h-36 resize-none"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setErrors((current) => ({ ...current, description: undefined }));
              }}
              maxLength={EVENT_DESCRIPTION_MAX_CHARS}
              placeholder={t("eventForm.placeholder.description")}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? "ev-desc-error" : undefined}
            />
            {errors.description && <p id="ev-desc-error" className="text-xs text-destructive">{errors.description}</p>}
          </div>
          <div>
            <Label>{t("eventForm.posterImage")}</Label>
            {posterUrl ? (
              <div className="relative mt-1 group">
                <img src={posterUrl} alt={t("eventForm.posterPreview")} className="max-h-64 w-full rounded-[1.2rem] object-cover shadow-md" />
                <div className="absolute top-2 right-2 flex gap-2">
                  <button
                    type="button"
                    onClick={recropExisting}
                    className="rounded-full bg-white/92 px-2.5 py-1 text-xs font-medium text-[#1a1a1a]/76 shadow-sm transition-[background-color,color,opacity,transform] duration-fast hover:bg-[#1a1a1a] hover:text-white"
                  >
                    {t("eventForm.adjust")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosterUrl(null)}
                    className="rounded-full bg-white/92 p-1.5 text-[#1a1a1a]/76 shadow-sm transition-[background-color,color,opacity,transform] duration-fast hover:bg-[#1a1a1a] hover:text-white"
                    aria-label={t("eventForm.removePoster")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[1.2rem] bg-card/70 py-8 shadow-sm transition-[background-color,box-shadow,transform] duration-fast hover:bg-card hover:shadow-md dark:hover:bg-secondary">
                {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{uploading ? t("eventForm.uploading") : t("eventForm.clickToUploadPoster")}</span>
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePicked(f); e.target.value = ""; }}
                  disabled={uploading}
                />
              </label>
            )}
            {errors.poster && <p className="mt-1 text-xs text-destructive">{errors.poster}</p>}
          </div>
          </div>
          </FlipScope>
        </DialogBody>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} className="w-full rounded-full shadow-sm sm:w-auto">{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving || uploading} className="w-full rounded-full border-0 bg-interactive text-interactive-text shadow-md transition-[background-color,box-shadow,transform] duration-fast hover:opacity-90 sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? t("eventForm.saveChanges") : t("eventForm.createEvent")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <Suspense fallback={null}>
        <ImageCropper
          open={!!cropSrc}
          imageSrc={cropSrc}
          onClose={() => setCropSrc(null)}
          onCropped={uploadBlob}
        />
      </Suspense>
    </Dialog>
  );
};
