import { describe, expect, it } from "vitest";

import {
  assertBacklineFile,
  assertBacklineFileBytes,
  assertEventPosterBytes,
  assertEventPosterFile,
  MAX_EVENT_POSTER_BYTES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  sniffFileMime,
  sniffMimeFromBytes,
} from "./file-validation";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string, pad = 0) =>
  new Uint8Array([...text.split("").map((c) => c.charCodeAt(0)), ...new Array(pad).fill(0)]);

/** A File whose declared `type` is a CLAIM, independent of its actual bytes — which
 *  is exactly the situation the sniff exists to catch. */
const fileOf = (content: Uint8Array, name: string, type: string) =>
  new File([content as unknown as BlobPart], name, { type });

describe("sniffMimeFromBytes", () => {
  it("identifies each supported signature", () => {
    expect(sniffMimeFromBytes(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMimeFromBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffMimeFromBytes(ascii("GIF89a"))).toBe("image/gif");
    expect(sniffMimeFromBytes(ascii("%PDF-1.7"))).toBe("application/pdf");
  });

  it("identifies WebP, which needs the tag at offset 8 and not just RIFF", () => {
    const webp = new Uint8Array(12);
    webp.set(ascii("RIFF"), 0);
    webp.set(ascii("WEBP"), 8);
    expect(sniffMimeFromBytes(webp)).toBe("image/webp");

    // RIFF alone is a container — a WAV is also RIFF, and must not read as WebP.
    const wav = new Uint8Array(12);
    wav.set(ascii("RIFF"), 0);
    wav.set(ascii("WAVE"), 8);
    expect(sniffMimeFromBytes(wav)).toBe("unknown");
  });

  it("returns unknown for anything unrecognised, including an empty head", () => {
    expect(sniffMimeFromBytes(ascii("MZ\u0090\u0000"))).toBe("unknown"); // a Windows executable
    expect(sniffMimeFromBytes(ascii("<svg xmlns"))).toBe("unknown");
    expect(sniffMimeFromBytes(new Uint8Array(0))).toBe("unknown");
  });
});

describe("sniffFileMime", () => {
  it("reads only the file header, not the whole file", async () => {
    const big = new Uint8Array(1024);
    big.set(bytes(0xff, 0xd8, 0xff), 0);
    expect(await sniffFileMime(new Blob([big as unknown as BlobPart]))).toBe("image/jpeg");
  });
});

describe("assertEventPosterBytes", () => {
  it("accepts a genuine image", async () => {
    const png = fileOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "poster.png", "image/png");
    await expect(assertEventPosterBytes(png)).resolves.toBeUndefined();
  });

  it("rejects a non-image renamed to look like one", async () => {
    // `file.type` here is what a browser really reports for a file named .jpg —
    // the declared type is derived from the extension, so the old check passed it.
    const disguised = fileOf(ascii("MZ\u0090\u0000"), "totally-a-photo.jpg", "image/jpeg");

    expect(() => assertEventPosterFile(disguised)).not.toThrow(); // the old gate is fooled
    await expect(assertEventPosterBytes(disguised)).rejects.toThrow("fileValidation.imageUnsupported");
  });

  it("rejects SVG, which passes a naive image/ prefix test", async () => {
    const svg = fileOf(ascii("<svg xmlns=\"http://www.w3.org/2000/svg\">"), "art.svg", "image/svg+xml");
    await expect(assertEventPosterBytes(svg)).rejects.toThrow("fileValidation.imageUnsupported");
  });

  it("rejects a PDF even though its signature is one we can detect", async () => {
    const pdf = fileOf(ascii("%PDF-1.7"), "poster.jpg", "image/jpeg");
    await expect(assertEventPosterBytes(pdf)).rejects.toThrow("fileValidation.imageUnsupported");
  });

  it("still applies the cheap declared-type and size checks first", async () => {
    const notAnImage = fileOf(bytes(0xff, 0xd8, 0xff), "notes.txt", "text/plain");
    await expect(assertEventPosterBytes(notAnImage)).rejects.toThrow("fileValidation.imageRequired");

    const huge = fileOf(bytes(0xff, 0xd8, 0xff), "huge.jpg", "image/jpeg");
    Object.defineProperty(huge, "size", { value: MAX_EVENT_POSTER_BYTES + 1 });
    await expect(assertEventPosterBytes(huge)).rejects.toThrow("fileValidation.posterImageMax");
  });
});

describe("assertBacklineFileBytes", () => {
  const jpegBytes = bytes(0xff, 0xd8, 0xff, 0xe0);

  it("accepts a real PDF and a real image", async () => {
    await expect(assertBacklineFileBytes(fileOf(ascii("%PDF-1.7"), "rates.pdf", "application/pdf"), "pdf"))
      .resolves.toBeUndefined();
    await expect(assertBacklineFileBytes(fileOf(jpegBytes, "gear.jpg", "image/jpeg"), "image"))
      .resolves.toBeUndefined();
  });

  it("rejects a non-PDF renamed to .pdf", async () => {
    // Matters MORE here than for a poster: backline files upload RAW, whereas a
    // poster is re-encoded through a canvas before it ever reaches storage.
    const disguised = fileOf(ascii("MZ "), "rates.pdf", "application/pdf");

    expect(() => assertBacklineFile(disguised, "pdf")).not.toThrow(); // the old gate is fooled
    await expect(assertBacklineFileBytes(disguised, "pdf")).rejects.toThrow("fileValidation.pdfRequired");
  });

  it("rejects SVG and HEIC, which the old image/ prefix test let through", async () => {
    const svg = fileOf(ascii("<svg xmlns=\"http://www.w3.org/2000/svg\">"), "gear.svg", "image/svg+xml");
    const heic = fileOf(ascii("????ftypheic"), "gear.heic", "image/heic");

    expect(() => assertBacklineFile(svg, "image")).not.toThrow();
    expect(() => assertBacklineFile(heic, "image")).not.toThrow();
    await expect(assertBacklineFileBytes(svg, "image")).rejects.toThrow("fileValidation.imageUnsupported");
    await expect(assertBacklineFileBytes(heic, "image")).rejects.toThrow("fileValidation.imageUnsupported");
  });

  it("requires the declared type to AGREE with the bytes, as the Edge Function does", async () => {
    // Real PNG bytes, but the browser reported image/jpeg from the extension.
    // upload-admin-file compares file.type against its own sniff and refuses this,
    // so accepting it client-side would only produce a confusing upload failure.
    const mismatched = fileOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "gear.jpg", "image/jpeg");
    await expect(assertBacklineFileBytes(mismatched, "image")).rejects.toThrow("fileValidation.imageUnsupported");
  });

  it("still applies the cheap declared-type and size checks first", async () => {
    const huge = fileOf(ascii("%PDF-1.7"), "rates.pdf", "application/pdf");
    Object.defineProperty(huge, "size", { value: MAX_PDF_BYTES + 1 });
    await expect(assertBacklineFileBytes(huge, "pdf")).rejects.toThrow("fileValidation.pdfMax");

    const oversizeImage = fileOf(jpegBytes, "gear.jpg", "image/jpeg");
    Object.defineProperty(oversizeImage, "size", { value: MAX_IMAGE_BYTES + 1 });
    await expect(assertBacklineFileBytes(oversizeImage, "image")).rejects.toThrow("fileValidation.imageMax");
  });
});
