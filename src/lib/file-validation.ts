// ── File validation ──────────────────────────────────────────────────────────
// Client-side size/type gates for uploads, surfaced as i18n keys so the form shows
// localized errors immediately. These mirror — but do not replace — the authoritative
// server-side checks in the upload-admin-file Edge Function (which sniffs magic bytes).
// Treat these as UX feedback, not security.
import type { TranslationKey } from "@/lib/i18n";

export const MAX_EVENT_POSTER_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const FILE_VALIDATION_ERROR = {
  imageRequired: "fileValidation.imageRequired",
  posterImageMax: "fileValidation.posterImageMax",
  pdfRequired: "fileValidation.pdfRequired",
  pdfMax: "fileValidation.pdfMax",
  imageMax: "fileValidation.imageMax",
} as const satisfies Record<string, TranslationKey>;

export const fileValidationTranslationKey = (error: unknown): TranslationKey | null => {
  const message = error instanceof Error ? error.message : "";
  const keys = Object.values(FILE_VALIDATION_ERROR) as TranslationKey[];
  return keys.includes(message as TranslationKey) ? (message as TranslationKey) : null;
};

export const assertEventPosterFile = (file: File) => {
  if (!file.type.startsWith("image/")) {
    throw new Error(FILE_VALIDATION_ERROR.imageRequired);
  }
  if (file.size > MAX_EVENT_POSTER_BYTES) {
    throw new Error(FILE_VALIDATION_ERROR.posterImageMax);
  }
};

export const assertBacklineFile = (file: File, contentType: "pdf" | "image") => {
  if (contentType === "pdf") {
    if (file.type !== "application/pdf") {
      throw new Error(FILE_VALIDATION_ERROR.pdfRequired);
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(FILE_VALIDATION_ERROR.pdfMax);
    }
    return;
  }

  if (!file.type.startsWith("image/")) {
    throw new Error(FILE_VALIDATION_ERROR.imageRequired);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(FILE_VALIDATION_ERROR.imageMax);
  }
};
