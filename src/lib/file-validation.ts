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
  imageUnsupported: "fileValidation.imageUnsupported",
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

// ── Magic-byte sniffing ──────────────────────────────────────────────────────
// `file.type` is derived by the browser from the FILE EXTENSION, so it is a claim,
// not evidence: rename anything to `.jpg` and it arrives as `image/jpeg`. These
// signatures mirror `detectMimeType` in the upload-admin-file Edge Function so the
// client rejects exactly what the server would, immediately and with a message that
// names the problem — instead of the file failing later, deeper in the flow, as
// something vague.
//
// This is a MIRROR, not a replacement. The Edge Function's sniff stays the
// authoritative one; anything here runs on the attacker's own machine.
const SNIFF_BYTES = 12;

export type SniffedMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf" | "unknown";

/** The raster image types both upload paths accept — the poster pipeline can decode
 *  and re-encode them, and they are exactly the set upload-admin-file allows through
 *  for backline. Notably excludes SVG (markup, not raster — it passes a naive
 *  `image/` prefix test) and HEIC (which only decodes in Safari). */
const SUPPORTED_RASTER_MIMES: readonly SniffedMime[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((value, index) => bytes[index] === value);

const asciiAt = (bytes: Uint8Array, start: number, text: string) =>
  text.split("").every((char, index) => bytes[start + index] === char.charCodeAt(0));

export const sniffMimeFromBytes = (bytes: Uint8Array): SniffedMime => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "image/webp";
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) return "image/gif";
  if (asciiAt(bytes, 0, "%PDF")) return "application/pdf";
  return "unknown";
};

/** Reads only the leading bytes — never the whole file into memory. */
export const sniffFileMime = async (file: Blob): Promise<SniffedMime> => {
  const head = await file.slice(0, SNIFF_BYTES).arrayBuffer();
  return sniffMimeFromBytes(new Uint8Array(head));
};

/**
 * The full poster gate: the cheap extension/size checks, then proof from the bytes
 * themselves. Async because reading the header is async — call it before opening
 * the cropper, so an unsupported file is refused up front rather than failing at
 * decode time as an unexplained error.
 */
export const assertEventPosterBytes = async (file: File) => {
  assertEventPosterFile(file);
  const sniffed = await sniffFileMime(file);
  if (!SUPPORTED_RASTER_MIMES.includes(sniffed)) {
    throw new Error(FILE_VALIDATION_ERROR.imageUnsupported);
  }
};

/** The cheap gate: extension-derived type and size only. Kept separate so the byte
 *  gate below can run it first, exactly as the poster pair does. */
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

/**
 * The full backline gate — proof from the bytes, not just the extension.
 *
 * This matters MORE here than it does for posters. A poster is re-encoded through
 * a canvas, so whatever reaches storage is a real JPEG no matter what went in;
 * backline PDFs and images upload **raw**. The Edge Function sniffs server-side
 * and is still the authority — nothing unsafe reaches the bucket either way — but
 * without this the client happily accepted files the server was always going to
 * reject, and reported it as a generic upload failure.
 *
 * Mirrors `validateBacklineFile` in upload-admin-file: the sniffed type must be
 * one the server allows AND must agree with `file.type`. That agreement check is
 * what the old `image/*` prefix test missed — an SVG (markup, not raster) and a
 * HEIC (undecodable outside Safari) both passed it.
 */
export const assertBacklineFileBytes = async (file: File, contentType: "pdf" | "image") => {
  assertBacklineFile(file, contentType);
  const sniffed = await sniffFileMime(file);

  if (contentType === "pdf") {
    if (sniffed !== "application/pdf") {
      throw new Error(FILE_VALIDATION_ERROR.pdfRequired);
    }
    return;
  }

  if (!SUPPORTED_RASTER_MIMES.includes(sniffed) || file.type !== sniffed) {
    throw new Error(FILE_VALIDATION_ERROR.imageUnsupported);
  }
};
