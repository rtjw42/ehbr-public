// ── upload-admin-file (AUTHENTICATED edge function) ──────────────────────────
// Trust boundary: NOT public. Omitted from supabase/config.toml so it keeps the
// platform default verify_jwt = true. It additionally re-verifies the bearer via
// auth.getUser() and checks the caller's user_roles for `admin` before doing any
// work — never trusting frontend state. Uploads are further constrained by
// server-side MIME + byte-size limits (MAX_*_BYTES) so a valid admin still cannot
// push oversized or unexpected file types.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertRequestSize,
  cleanErrorMessage,
  handleCors,
  json,
} from "../_shared/security.ts";

const MAX_EVENT_POSTER_BYTES = 5 * 1024 * 1024;
const MAX_BACKLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BACKLINE_PDF_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BODY_BYTES = 11 * 1024 * 1024;

type UploadKind = "event-poster" | "backline-file";
type BacklineContentType = "pdf" | "image";
type SectionKey = "gear" | "rates";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const bytesStartWith = (bytes: Uint8Array, signature: number[]) => (
  signature.every((value, index) => bytes[index] === value)
);

const asciiAt = (bytes: Uint8Array, start: number, text: string) => (
  text.split("").every((char, index) => bytes[start + index] === char.charCodeAt(0))
);

const detectMimeType = (bytes: Uint8Array) => {
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "image/webp";
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) return "image/gif";
  if (asciiAt(bytes, 0, "%PDF")) return "application/pdf";
  return "application/octet-stream";
};

const extensionForMime = (mimeType: string) => {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "jpg";
};

const cleanFileName = (value: string) => {
  const cleaned = value.replace(/<[^>]*>/g, "").replace(/[^\w.\- ]+/g, "").trim();
  return cleaned || "upload";
};

const validateEventPoster = (file: File, detectedMime: string) => {
  if (file.size > MAX_EVENT_POSTER_BYTES) throw new Error("Poster image must be 5MB or smaller.");
  if (file.type !== "image/jpeg" || detectedMime !== "image/jpeg") {
    throw new Error("Poster image must be a JPEG image.");
  }
};

const validateBacklineFile = (file: File, contentType: BacklineContentType, detectedMime: string) => {
  if (contentType === "pdf") {
    if (file.size > MAX_BACKLINE_PDF_BYTES) throw new Error("PDF files must be 10MB or smaller.");
    if (file.type !== "application/pdf" || detectedMime !== "application/pdf") {
      throw new Error("PDF file must be a PDF.");
    }
    return;
  }

  if (file.size > MAX_BACKLINE_IMAGE_BYTES) throw new Error("Images must be 5MB or smaller.");
  if (!allowedImageTypes.has(file.type) || file.type !== detectedMime) {
    throw new Error("Image file must be a JPEG, PNG, WebP, or GIF image.");
  }
};

const requireString = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors.response) return cors.response;
  const { origin } = cors;

  if (req.method !== "POST") {
    return json(origin, { error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("upload-admin-file missing Supabase environment");
    return json(origin, { error: "Could not upload file." }, 500);
  }

  try {
    assertRequestSize(req, MAX_MULTIPART_BODY_BYTES, true);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(origin, { error: "Admin session is required." }, 401);
    }

    const authSupabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authSupabase.auth.getUser();
    if (userError || !user) {
      return json(origin, { error: "Admin session is required." }, 401);
    }

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: roles, error: roleError } = await serviceSupabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .limit(10);
    if (roleError) throw roleError;
    if (!roles?.some((row) => row.role === "admin")) {
      return json(origin, { error: "Admin access is required." }, 403);
    }

    const formData = await req.formData();
    const kind = requireString(formData, "kind") as UploadKind;
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return json(origin, { error: "File is required." }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedMime = detectMimeType(bytes);

    if (kind === "event-poster") {
      validateEventPoster(file, detectedMime);
      const path = `${Date.now()}-${crypto.randomUUID()}.jpg`;
      const { error } = await serviceSupabase.storage.from("event-posters").upload(path, file, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error) throw error;
      const { data } = serviceSupabase.storage.from("event-posters").getPublicUrl(path);
      return json(origin, { ok: true, publicUrl: data.publicUrl });
    }

    if (kind === "backline-file") {
      const sectionKey = requireString(formData, "sectionKey") as SectionKey;
      const contentType = requireString(formData, "contentType") as BacklineContentType;
      if (sectionKey !== "gear" && sectionKey !== "rates") {
        return json(origin, { error: "Invalid backline section." }, 400);
      }
      if (contentType !== "pdf" && contentType !== "image") {
        return json(origin, { error: "Invalid backline file type." }, 400);
      }

      validateBacklineFile(file, contentType, detectedMime);
      const extension = extensionForMime(detectedMime);
      const filePath = `${sectionKey}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const fileName = cleanFileName(file.name);
      const { error } = await serviceSupabase.storage.from("backline-documents").upload(filePath, file, {
        cacheControl: "3600",
        contentType: detectedMime,
        upsert: true,
      });
      if (error) throw error;
      return json(origin, { ok: true, filePath, fileName, mimeType: detectedMime });
    }

    return json(origin, { error: "Invalid upload request." }, 400);
  } catch (error) {
    console.error("upload-admin-file error", error);
    const message = cleanErrorMessage(error, "Could not upload file.");
    const status = /too large/i.test(message)
      ? 413
      : /required|invalid|must|5MB|10MB|PDF|JPEG|PNG|WebP|GIF|request size/i.test(message) ? 400 : 500;
    return json(origin, { error: message }, status);
  }
});
