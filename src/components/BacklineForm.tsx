// ── Backline form ────────────────────────────────────────────────────────────
// Admin-only editor for one Backline section (Gear or Rates): title, content type,
// and either inline text or an uploaded PDF/image.
//
// Named `*Form`, not `*Dialog`, on purpose: in this codebase the suffix says which
// shell a modal is built on — `*Form` is on `FormShell` (BookingForm, EventForm),
// `*Dialog` is on the raw Radix Dialog (DayDetailDialog, BookingGuidelinesDialog,
// TurnstileVerificationDialog). It carried the `*Dialog` name while it was still an
// inline component in the page; keeping that after the Form System port would have
// made the name say the opposite of what this is.
//
// ── Why this is its own file ─────────────────────────────────────────────────
// It used to live inside `pages/Backline.tsx`, which put it in the public page
// chunk: every anonymous visitor to /backline downloaded the whole admin form —
// plus the `form-shell` and `upload-field` chunks it pulls in — for a form they can
// never open. Measured at 5.28 → 8.83 kB gzip on that route; extracting it took the
// public route to 3.08. It is now `lazy()`-imported AND gated on
// `showAdminControls`; both halves are needed, because lazy alone still fetches
// once the component mounts. See DESIGN_SYSTEM.md → Form System.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormShell, type FormScreen } from "@/components/ui/form-shell";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { UploadField } from "@/components/ui/upload-field";
import { backlineSectionLabel } from "@/lib/backline-labels";
import { getErrorMessage } from "@/lib/errors";
import { assertBacklineFileBytes, fileValidationTranslationKey } from "@/lib/file-validation";
import { crossfadeTransition } from "@/lib/motion";
import { sanitizeDisplayText, stripHtmlText } from "@/lib/sanitize";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { useInvalidFieldFocus } from "@/hooks/useInvalidFieldFocus";
import {
  saveBacklineContent,
  uploadBacklineFile,
  type BacklineContent,
  type BacklineContentType,
  type BacklineFileMetadata,
  type SectionKey,
} from "@/services/backline";

const BACKLINE_TITLE_MAX_CHARS = 255;
const BACKLINE_BODY_MAX_CHARS = 5000;

// ── Two things the Form System port fixed beyond the shell swap ──────────────
//
//   1. The content-type Radix <Select> is gone. It was the LAST portalled dropdown
//      inside a form, and portalling escaped the scroll-bounds clamp PickerDropdown
//      exists to guarantee — so it was the one surface that could render past the
//      sheet's edge or flip above its own trigger. Text │ PDF │ Image is a small
//      fixed set, which is a SegmentedControl by the dropdown-language rule.
//   2. Switching type no longer resizes the form. The content slot is ONE fixed
//      height for all three modes, and the modes crossfade inside it (opacity only,
//      the shell's own screen-swap language). With a segmented control the switch is
//      a single tap, so an unreserved slot would have jumped constantly.
//
// A stored file only counts for the type it was uploaded as: switching pdf → image
// and saving used to keep `file_path` pointing at the old PDF while `content_type`
// said "image", which the public card then tried to render in an <img>.
const CONTENT_SLOT = "h-40"; // one height, every mode — see (2) above

type BacklineFormErrors = { title?: string; bodyText?: string; file?: string };
type BacklineFormErrorKey = keyof BacklineFormErrors;
// Visual top-down order. `bodyText` and `file` are the same slot in different content
// modes, so at most one of them is ever set.
const FIELD_ORDER: readonly BacklineFormErrorKey[] = ["title", "bodyText", "file"];

interface Props {
  open: boolean;
  /** The section being edited. Held by the host across a close, so it is still
      here while the sheet is on its way out. */
  section: BacklineContent | null;
  previewUrl: string;
  onClose: () => void;
  onSaved: () => void;
}

export const BacklineForm = ({ open, section, previewUrl, onClose, onSaved }: Props) => {
  const { ensureAdminSession } = useAdmin();
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<BacklineContentType>("text");
  const [bodyText, setBodyText] = useState("");
  const [picked, setPicked] = useState<{ file: File; url: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<BacklineFormErrors>({});
  // A refused save scrolls to the first bad field and focuses it — the shared
  // behaviour (DESIGN_SYSTEM -> Form System -> Failure behaviour).
  const { setFieldRef, focusFirstInvalidField } = useInvalidFieldFocus<BacklineFormErrorKey>();
  const { t } = useI18n();

  // Object URLs are process-wide — the browser will not reclaim one just because
  // the state holding it was replaced. Route every set through here so the replace
  // path and unmount share one revoke.
  const pickedUrlRef = useRef<string | null>(null);
  const setPickedTracked = useCallback((next: { file: File; url: string | null } | null) => {
    if (pickedUrlRef.current) URL.revokeObjectURL(pickedUrlRef.current);
    pickedUrlRef.current = next?.url ?? null;
    setPicked(next);
  }, []);
  useEffect(() => () => {
    if (pickedUrlRef.current) URL.revokeObjectURL(pickedUrlRef.current);
    pickedUrlRef.current = null;
  }, []);

  // useLayoutEffect, NOT useEffect — the same stale-frame bug EventForm hit. This
  // component stays mounted between openings, so every field still holds the last
  // session's values when it reopens; a passive effect paints those first and
  // resets them a frame later, visible behind the sheet's entrance. Keyed on `open`
  // as well as `section`: the host holds the section across a close, so reopening
  // the same one hands back an identical object and `section` alone would not fire.
  useLayoutEffect(() => {
    if (!open || !section) return;
    setTitle(section.title);
    setContentType(section.content_type as BacklineContentType);
    setBodyText(section.body_text ?? "");
    setPickedTracked(null);
    setErrors({});
    // Cleared here rather than on save's success path — see the note there.
    setSaving(false);
  }, [open, section, setPickedTracked]);

  // Only fade the slot on a swap the user actually made; the first render while
  // open belongs to the sheet's own entrance. Mirrors FormShell's fadeReadyRef.
  const fadeReadyRef = useRef(false);
  useEffect(() => {
    fadeReadyRef.current = open;
  }, [open]);

  const isFileMode = contentType !== "text";
  // Narrowed for the upload calls, which take only "pdf" | "image". Every reader
  // sits behind `isFileMode` or inside UploadField, which mounts only in file mode,
  // so the "text" case never reaches it.
  const fileMode = contentType === "pdf" ? "pdf" : "image";
  // A persisted file belongs to the type it was uploaded as. These two are
  // mutually exclusive, which is what keeps the states legible: either the stored
  // file is still usable, or saving is about to delete it.
  const storedFileUsable = !!section?.file_path && section.content_type === contentType;
  const storedFileDoomed = !!section?.file_path && section.content_type !== contentType;

  // Named, not "the uploaded file": that phrasing reads as the file just picked, and
  // with no location it sounds like a deletion from the user's own device. The name
  // is user-supplied, so it sanitizes like every other display value. A row can carry
  // a `file_path` with no `file_name`, hence the fallback.
  const doomedFileName =
    sanitizeDisplayText(section?.file_name) || t("backline.storedFileFallback");

  // Filenames are user-supplied, so they go through the sanitize helper like every
  // other display value — including the freshly picked one, which is whatever the
  // OS file picker handed back.
  const filled = picked
    ? { src: picked.url, name: sanitizeDisplayText(picked.file.name) }
    : storedFileUsable
      ? {
          src: contentType === "image" ? previewUrl || null : null,
          name: sanitizeDisplayText(section?.file_name) || t("backline.contentFallback"),
        }
      : null;

  const handlePick = async (file: File) => {
    try {
      // The byte gate, not the extension one. Backline files upload RAW (unlike a
      // poster, which is re-encoded through a canvas), so this is the client's only
      // look at what the bytes actually are before they leave the device.
      await assertBacklineFileBytes(file, fileMode);
    } catch (error: unknown) {
      setPickedTracked(null);
      const validationKey = fileValidationTranslationKey(error);
      setErrors((current) => ({
        ...current,
        file: validationKey ? t(validationKey) : getErrorMessage(error, t("validation.fileInvalid")),
      }));
      return;
    }
    setPickedTracked({ file, url: contentType === "image" ? URL.createObjectURL(file) : null });
    setErrors((current) => ({ ...current, file: undefined }));
  };

  const save = async () => {
    if (saving || !section) return;
    const cleanTitle = stripHtmlText(title);
    const cleanBodyText = stripHtmlText(bodyText);
    const nextErrors = {
      title: cleanTitle ? undefined : t("validation.titleRequired"),
      bodyText: contentType === "text" && !cleanBodyText ? t("validation.textContentRequired") : undefined,
      file: isFileMode && !picked && !storedFileUsable ? t("validation.fileRequired") : undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.bodyText || nextErrors.file) {
      focusFirstInvalidField(nextErrors, FIELD_ORDER);
      return;
    }

    // `saving` goes up BEFORE the session check, not after. ensureAdminSession is a
    // live network round-trip; on a phone that is a real pause during which the
    // button showed no spinner AND the `if (saving) return` guard did not hold, so
    // a second tap started a second save.
    setSaving(true);
    try {
      if (!(await ensureAdminSession())) {
        setSaving(false);
        return;
      }

      let fileMetadata: BacklineFileMetadata | null = null;
      if (isFileMode) {
        if (picked) {
          // Caught separately so the toast blames the upload rather than the save,
          // which never ran. The form is left intact, so Save can just be retried.
          try {
            fileMetadata = await uploadBacklineFile({
              sectionKey: section.section_key as SectionKey,
              contentType: fileMode,
              file: picked.file,
            });
          } catch (error: unknown) {
            const validationKey = fileValidationTranslationKey(error);
            toast.error(
              error instanceof TypeError
                ? t("common.networkIssue")
                : validationKey ? t(validationKey) : getErrorMessage(error, t("backline.saveFailed")),
            );
            setSaving(false);
            return;
          }
        } else {
          fileMetadata = {
            filePath: section.file_path as string,
            fileName: section.file_name,
            mimeType: section.mime_type,
          };
        }
      }

      await saveBacklineContent({
        sectionKey: section.section_key as SectionKey,
        title,
        contentType,
        bodyText,
        fileMetadata,
      });
      toast.success(t("backline.saved"));
      onSaved();
      // `saving` is deliberately NOT cleared here: the sheet is exit-animating by
      // now, and repainting the footer back to its idle label mid-exit is a flicker.
      // The open reset clears it instead.
    } catch (error: unknown) {
      toast.error(
        error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("backline.saveFailed")),
      );
      setSaving(false);
    }
  };

  const contentLabel = contentType === "text" ? t("backline.text") : contentType === "pdf" ? "PDF" : t("backline.image");

  const formScreen: FormScreen = {
    key: "form",
    title: t("backline.editTitle", {
      section: section?.section_key ? backlineSectionLabel(section.section_key, t) : t("backline.contentFallback"),
    }),
    body: (
      <div className="space-y-5">
        <FormField
          id="bl-title"
          label={t("backline.formTitle")}
          labelTrailing={t("backline.charCounter", { count: title.length, max: BACKLINE_TITLE_MAX_CHARS })}
          error={errors.title}
        >
          <Input
            id="bl-title"
            ref={setFieldRef("title")}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((current) => ({ ...current, title: undefined }));
            }}
            maxLength={BACKLINE_TITLE_MAX_CHARS}
            aria-invalid={!!errors.title}
          />
        </FormField>

        <div className="space-y-1.5">
          <span id="bl-type-label" className="text-sm font-medium leading-none">
            {t("backline.contentType")}
          </span>
          <SegmentedControl<BacklineContentType>
            ariaLabelledBy="bl-type-label"
            value={contentType}
            onChange={(next) => {
              setContentType(next);
              setPickedTracked(null);
              setErrors((current) => ({ ...current, bodyText: undefined, file: undefined }));
            }}
            options={[
              { value: "text", label: t("backline.text") },
              { value: "pdf", label: "PDF" },
              { value: "image", label: t("backline.image") },
            ]}
          />
        </div>

        {/* One id across all three modes, so the label and the derived error id
            stay wired no matter which control is mounted. */}
        <FormField
          id="bl-content"
          label={contentLabel}
          labelTrailing={
            contentType === "text"
              ? t("backline.charCounter", { count: bodyText.length, max: BACKLINE_BODY_MAX_CHARS })
              : undefined
          }
          error={contentType === "text" ? errors.bodyText : errors.file}
        >
          <div className={CONTENT_SLOT}>
            <motion.div
              key={contentType}
              initial={fadeReadyRef.current ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={crossfadeTransition}
              className="h-full"
            >
              {contentType === "text" ? (
                <Textarea
                  id="bl-content"
                  ref={setFieldRef("bodyText")}
                  // Fixed `h-40`, not `min-h-40`. A min-height grows as you type,
                  // which is a resize by definition; this scrolls internally instead.
                  className="h-full resize-none"
                  value={bodyText}
                  onChange={(e) => {
                    setBodyText(e.target.value);
                    setErrors((current) => ({ ...current, bodyText: undefined }));
                  }}
                  maxLength={BACKLINE_BODY_MAX_CHARS}
                  placeholder={t("backline.textPlaceholder")}
                  aria-invalid={!!errors.bodyText}
                />
              ) : (
                <UploadField
                  id="bl-content"
                  ref={setFieldRef("file")}
                  // Concrete types, never "image/*": it matches what the byte sniff
                  // will accept, and on iOS it makes the picker hand back a JPEG
                  // rather than a HEIC nothing outside Safari can decode.
                  accept={contentType === "pdf" ? "application/pdf" : "image/jpeg,image/png,image/webp,image/gif"}
                  onPick={handlePick}
                  prompt={contentType === "pdf" ? t("backline.uploadPdf") : t("backline.uploadImage")}
                  filled={filled}
                  fit="contain"
                  replaceLabel={t("backline.replaceFile")}
                  actions={
                    picked ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 rounded-full shadow-sm"
                        onClick={() => setPickedTracked(null)}
                        aria-label={t("backline.removeFile")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null
                  }
                  className="h-full w-full"
                  invalid={!!errors.file}
                />
              )}
            </motion.div>
          </div>
          {/* Inline rather than header chrome: this appears the instant the user
              taps the segmented control, so they are already looking at it. */}
          {storedFileDoomed ? (
            <p className="text-xs text-muted-foreground">
              {t("backline.fileWillBeRemoved", { file: doomedFileName })}
            </p>
          ) : null}
        </FormField>
      </div>
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </>
    ),
  };

  return (
    <FormShell
      open={open}
      // Guarded here rather than through the screen's `dismissable` flag: that flag
      // also controls whether the close button renders, so toggling it on `saving`
      // would make the header jump the instant Save was pressed.
      onOpenChange={(next) => {
        if (next || saving) return;
        onClose();
      }}
      stack={[formScreen]}
    />
  );
};
