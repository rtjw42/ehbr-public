import { describe, expect, it, vi, beforeEach } from "vitest";
import { supabaseMock, queryResult, resetSupabaseMock } from "@/test/supabase-mock";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import {
  buildBacklinePayload,
  cleanFileName,
  downloadFileNameForContent,
  extensionFromMime,
  normalizeBacklineError,
  validateBacklineFile,
  loadBacklineContent,
  uploadBacklineFile,
  saveBacklineContent,
  downloadBacklineFile,
  type BacklineContent,
} from "./backline";

const baseContent: BacklineContent = {
  id: "gear",
  section_key: "gear",
  content_type: "image",
  title: "Gear List",
  body_text: null,
  file_path: "gear/file.jpg",
  file_name: "gear.jpg",
  mime_type: "image/jpeg",
  created_at: "",
  updated_at: "",
};

beforeEach(() => resetSupabaseMock());

describe("backline service helpers", () => {
  it("builds text content payloads with sanitized text and nulled file fields", () => {
    expect(buildBacklinePayload({
      sectionKey: "gear",
      title: "<strong>Gear</strong>",
      contentType: "text",
      bodyText: "<img src=x onerror=alert(1)>Guitars",
      fileMetadata: { filePath: "gear/old.pdf", fileName: "old.pdf", mimeType: "application/pdf" },
    })).toEqual({
      section_key: "gear",
      title: "Gear",
      content_type: "text",
      body_text: "Guitars",
      file_path: null,
      file_name: null,
      mime_type: null,
    });
  });

  it("builds file content payloads with sanitized metadata", () => {
    expect(buildBacklinePayload({
      sectionKey: "rates",
      title: "Rates",
      contentType: "pdf",
      bodyText: "ignored",
      fileMetadata: { filePath: "rates/123.pdf", fileName: "<b>Rate Card!!</b>.pdf", mimeType: "application/pdf" },
    })).toEqual({
      section_key: "rates",
      title: "Rates",
      content_type: "pdf",
      body_text: null,
      file_path: "rates/123.pdf",
      file_name: "Rate Card.pdf",
      mime_type: "application/pdf",
    });
  });

  it("cleans filenames and resolves display download names", () => {
    expect(cleanFileName("bad!!.pdf")).toBe("bad.pdf");
    expect(cleanFileName(null)).toBeNull();
    expect(downloadFileNameForContent({ ...baseContent, content_type: "pdf", section_key: "gear" })).toBe("equipment-list.pdf");
    expect(downloadFileNameForContent({ ...baseContent, file_name: null, mime_type: "image/png" })).toBe("gear-list.png");
  });

  it("maps MIME types to fallback extensions", () => {
    expect(extensionFromMime("application/pdf")).toBe("pdf");
    expect(extensionFromMime("image/webp")).toBe("webp");
    expect(extensionFromMime(null)).toBe("jpg");
  });

  it("validates PDF and image file size/type", () => {
    expect(() => validateBacklineFile({ size: 100, type: "application/pdf" } as File, "pdf")).not.toThrow();
    expect(() => validateBacklineFile({ size: 100, type: "image/png" } as File, "image")).not.toThrow();
    expect(() => validateBacklineFile({ size: 100, type: "text/plain" } as File, "pdf")).toThrow("PDF file must be a PDF.");
    expect(() => validateBacklineFile({ size: 100, type: "application/pdf" } as File, "image")).toThrow("Image file must be an image.");
    expect(() => validateBacklineFile({ size: 10 * 1024 * 1024 + 1, type: "application/pdf" } as File, "pdf")).toThrow("PDF files must be 10MB or smaller.");
    expect(() => validateBacklineFile({ size: 5 * 1024 * 1024 + 1, type: "image/jpeg" } as File, "image")).toThrow("Images must be 5MB or smaller.");
  });

  it("normalizes backline errors to safe messages", () => {
    expect(normalizeBacklineError("PDF too large", "fallback")).toBe("PDF files must be 10MB or smaller.");
    expect(normalizeBacklineError("invalid PDF", "fallback")).toBe("PDF file must be a PDF.");
    expect(normalizeBacklineError("image too large", "fallback")).toBe("Images must be 5MB or smaller.");
    expect(normalizeBacklineError("invalid MIME content type", "fallback")).toBe("Image file must be an image.");
    expect(normalizeBacklineError({ message: "raw storage detail" }, "Could not save backline content.")).toBe("Could not save backline content.");
  });
});

describe("loadBacklineContent", () => {
  it("overlays DB rows onto the defaults", async () => {
    supabaseMock.from.mockReturnValue(queryResult({
      data: [{ ...baseContent, section_key: "gear", title: "Real Gear" }],
      error: null,
    }));
    const result = await loadBacklineContent();
    expect(result.gear.title).toBe("Real Gear");
    expect(result.rates.title).toBe("Rates"); // untouched default
  });

  it("returns pure defaults when there are no rows", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: [], error: null }));
    const result = await loadBacklineContent();
    expect(result.gear.content_type).toBe("text");
  });
});

describe("uploadBacklineFile", () => {
  it("uploads through the edge function and returns metadata", async () => {
    supabaseMock.functions.invoke.mockResolvedValue({
      data: { filePath: "gear/1.pdf", fileName: "list.pdf", mimeType: "application/pdf" },
      error: null,
    });
    const file = new File(["x"], "list.pdf", { type: "application/pdf" });
    const result = await uploadBacklineFile({ sectionKey: "gear", contentType: "pdf", file });
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith("upload-admin-file", expect.any(Object));
    expect(result.filePath).toBe("gear/1.pdf");
  });

  it("rejects a wrong-type file before invoking", async () => {
    const file = new File(["x"], "list.txt", { type: "text/plain" });
    await expect(uploadBacklineFile({ sectionKey: "gear", contentType: "pdf", file }))
      .rejects.toThrow("PDF file must be a PDF.");
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled();
  });
});

describe("saveBacklineContent / downloadBacklineFile", () => {
  it("upserts content on the section_key conflict target", async () => {
    const builder = queryResult({ data: null, error: null });
    supabaseMock.from.mockReturnValue(builder);
    await saveBacklineContent({ sectionKey: "gear", title: "G", contentType: "text", bodyText: "hi", fileMetadata: null });
    expect(builder.upsert).toHaveBeenCalledWith(expect.any(Object), { onConflict: "section_key" });
  });

  it("removes the previous file object in-flow when a save replaces it", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: { file_path: "gear/old.pdf" }, error: null }));
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    supabaseMock.storage.from.mockReturnValue({ remove });

    // Switching to text content nulls file_path → the old file is now orphaned.
    await saveBacklineContent({ sectionKey: "gear", title: "G", contentType: "text", bodyText: "hi", fileMetadata: null });

    expect(supabaseMock.storage.from).toHaveBeenCalledWith("backline-documents");
    expect(remove).toHaveBeenCalledWith(["gear/old.pdf"]);
  });

  it("downloads a stored file from the backline bucket", async () => {
    const blob = new Blob(["pdf"]);
    const download = vi.fn().mockResolvedValue({ data: blob, error: null });
    supabaseMock.storage.from.mockReturnValue({ download });
    const result = await downloadBacklineFile("gear/1.pdf");
    expect(supabaseMock.storage.from).toHaveBeenCalledWith("backline-documents");
    expect(download).toHaveBeenCalledWith("gear/1.pdf");
    expect(result).toBe(blob);
  });
});
