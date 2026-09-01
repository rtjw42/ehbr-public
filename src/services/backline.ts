// ── Backline service ─────────────────────────────────────────────────────────
// The Gear and Rates sections — each is either inline text or an uploaded PDF/image.
// Reads are public; writes assume a verified admin session (RLS enforces it). Files
// upload through the upload-admin-file Edge Function (which re-validates server-side)
// and download from the backline-documents storage bucket.
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { MAX_IMAGE_BYTES, MAX_PDF_BYTES } from "@/lib/file-validation";
import { stripHtmlText } from "@/lib/sanitize";

// ── Types ────────────────────────────────────────────────────────────────────
export type BacklineContent = Tables<"backline_content">;
export type SectionKey = "gear" | "rates";
export type BacklineContentType = "pdf" | "image" | "text";

export type BacklineFileMetadata = {
  filePath: string;
  fileName: string | null;
  mimeType: string | null;
};

export type BacklineSaveInput = {
  sectionKey: SectionKey;
  title: string;
  contentType: BacklineContentType;
  bodyText: string;
  fileMetadata: BacklineFileMetadata | null;
};

export type BacklineUploadInput = {
  sectionKey: SectionKey;
  contentType: Exclude<BacklineContentType, "text">;
  file: File;
};

type BacklinePayload = {
  section_key: SectionKey;
  title: string;
  content_type: BacklineContentType;
  body_text: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
};

// ── Defaults ─────────────────────────────────────────────────────────────────
// Shown until an admin saves real content, so the page is never blank for a section
// that has no row yet.
const DOWNLOAD_FILE_NAMES: Record<SectionKey, string> = {
  gear: "equipment-list.pdf",
  rates: "rate-card.pdf",
};

export const DEFAULT_BACKLINE_CONTENT: Record<SectionKey, BacklineContent> = {
  gear: {
    id: "gear",
    section_key: "gear",
    content_type: "text",
    title: "Gear",
    body_text: "Gear information will be added soon.",
    file_path: null,
    file_name: null,
    mime_type: null,
    created_at: "",
    updated_at: "",
  },
  rates: {
    id: "rates",
    section_key: "rates",
    content_type: "text",
    title: "Rates",
    body_text: "Rates information will be added soon.",
    file_path: null,
    file_name: null,
    mime_type: null,
    created_at: "",
    updated_at: "",
  },
};

// ── Error normalization ──────────────────────────────────────────────────────
// Map known server/Edge errors to safe user copy; fall back to a generic message.
const messageFromUnknown = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

export const normalizeBacklineError = (error: unknown, fallback: string) => {
  const message = messageFromUnknown(error);
  if (/pdf.*10mb|10mb.*pdf|pdf.*too large/i.test(message)) return "PDF files must be 10MB or smaller.";
  if (/pdf/i.test(message)) return "PDF file must be a PDF.";
  if (/image.*5mb|5mb.*image|image.*too large/i.test(message)) return "Images must be 5MB or smaller.";
  if (/image|mime|content type/i.test(message)) return "Image file must be an image.";
  return fallback;
};

const throwBacklineError = (error: unknown, fallback: string): never => {
  throw new Error(normalizeBacklineError(error, fallback));
};

const readFunctionErrorMessage = async (error: unknown, fallback: string) => {
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.clone().json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Keep the safe fallback below.
    }
  }
  return messageFromUnknown(error) || fallback;
};

// ── File naming & validation ─────────────────────────────────────────────────
// Download names prefer a fixed per-section name (equipment-list.pdf / rate-card.pdf),
// falling back to a slug of the title. validateBacklineFile is early UX feedback —
// the Edge Function re-checks type/size by magic bytes server-side.
export const cleanFileName = (value: string | null) => {
  if (!value) return null;
  const cleaned = stripHtmlText(value).replace(/[^\w.\- ]+/g, "").trim();
  return cleaned || null;
};

const slugifyBacklineFileName = (value: string) =>
  stripHtmlText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "backline-file";

export const extensionFromMime = (mimeType: string | null) => {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "jpg";
};

export const downloadFileNameForContent = (item: Pick<BacklineContent, "section_key" | "content_type" | "file_name" | "mime_type" | "title">) => {
  const sectionKey = item.section_key as SectionKey;
  if (item.content_type === "pdf") return DOWNLOAD_FILE_NAMES[sectionKey] ?? `${slugifyBacklineFileName(item.title)}.pdf`;
  return cleanFileName(item.file_name) ?? `${slugifyBacklineFileName(item.title)}.${extensionFromMime(item.mime_type)}`;
};

export const validateBacklineFile = (file: Pick<File, "size" | "type">, contentType: Exclude<BacklineContentType, "text">) => {
  if (contentType === "pdf") {
    if (file.type !== "application/pdf") throw new Error("PDF file must be a PDF.");
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF files must be 10MB or smaller.");
    return;
  }
  if (!file.type.startsWith("image/")) throw new Error("Image file must be an image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 5MB or smaller.");
};

export const buildBacklinePayload = (input: BacklineSaveInput): BacklinePayload => {
  const title = stripHtmlText(input.title);
  const bodyText = stripHtmlText(input.bodyText);
  return {
    section_key: input.sectionKey,
    title,
    content_type: input.contentType,
    body_text: input.contentType === "text" ? bodyText : null,
    file_path: input.contentType === "text" ? null : input.fileMetadata?.filePath ?? null,
    file_name: input.contentType === "text" ? null : cleanFileName(input.fileMetadata?.fileName ?? null),
    mime_type: input.contentType === "text" ? null : input.fileMetadata?.mimeType ?? null,
  };
};

// ── Reads (public) ───────────────────────────────────────────────────────────
// Start from the defaults and overlay whatever rows exist, so a missing section
// degrades to its placeholder instead of disappearing.
export const loadBacklineContent = async () => {
  const { data, error } = await supabase
    .from("backline_content")
    .select("*")
    .in("section_key", ["gear", "rates"])
    .limit(2);

  if (error) throwBacklineError(error, "Could not load backline content.");

  const next = { ...DEFAULT_BACKLINE_CONTENT };
  data?.forEach((item) => {
    if (item.section_key === "gear" || item.section_key === "rates") {
      next[item.section_key] = item;
    }
  });
  return next;
};

// ── Admin writes & download ──────────────────────────────────────────────────
export const uploadBacklineFile = async (input: BacklineUploadInput): Promise<BacklineFileMetadata> => {
  // Assumes caller has already verified an admin session.
  try {
    validateBacklineFile(input.file, input.contentType);
    const formData = new FormData();
    formData.append("kind", "backline-file");
    formData.append("sectionKey", input.sectionKey);
    formData.append("contentType", input.contentType);
    formData.append("file", input.file, cleanFileName(input.file.name) ?? `${input.sectionKey}.${extensionFromMime(input.file.type)}`);
    const { data, error } = await supabase.functions.invoke("upload-admin-file", {
      body: formData,
    });
    if (error) {
      const message = await readFunctionErrorMessage(error, "Could not upload backline file.");
      throw new Error(message);
    }
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { filePath?: unknown }).filePath !== "string"
    ) {
      throw new Error("Could not upload backline file.");
    }
    const result = data as { filePath: string; fileName?: unknown; mimeType?: unknown };
    return {
      filePath: result.filePath,
      fileName: typeof result.fileName === "string" ? result.fileName : null,
      mimeType: typeof result.mimeType === "string" ? result.mimeType : null,
    };
  } catch (error: unknown) {
    return throwBacklineError(error, "Could not upload backline file.");
  }
};

const BACKLINE_BUCKET = "backline-documents";

// In-flow orphan cleanup. Best-effort by design: removing the old object must
// never block or fail the primary write. Deletion is gated by the admin storage
// RLS policy.
const removeBacklineObject = async (filePath: string | null) => {
  if (!filePath) return;
  try {
    await supabase.storage.from(BACKLINE_BUCKET).remove([filePath]);
  } catch {
    // Swallow — orphan cleanup is opportunistic, not load-bearing.
  }
};

export const saveBacklineContent = async (input: BacklineSaveInput) => {
  // Assumes caller has already verified an admin session.
  const payload = buildBacklinePayload(input);

  // Capture the persisted file before the upsert so a replaced file (or a switch
  // to text content, which nulls file_path) deletes the old object in-flow.
  const { data: existing } = await supabase
    .from("backline_content")
    .select("file_path")
    .eq("section_key", input.sectionKey)
    .maybeSingle();
  const previousFilePath = (existing as { file_path: string | null } | null)?.file_path ?? null;

  const { error } = await supabase
    .from("backline_content")
    .upsert(payload, { onConflict: "section_key" });

  if (error) throwBacklineError(error, "Could not save backline content.");

  if (previousFilePath && previousFilePath !== payload.file_path) {
    await removeBacklineObject(previousFilePath);
  }
};

export const downloadBacklineFile = async (filePath: string) => {
  const { data, error } = await supabase.storage.from("backline-documents").download(filePath);
  if (error) throwBacklineError(error, "Could not download backline file.");
  return data;
};
