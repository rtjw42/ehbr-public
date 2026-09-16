import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CropError, cropToJpegBlob, MAX_CROP_EDGE } from "./image-crop";

// jsdom implements neither canvas nor image decoding, so both are stubbed. What is
// under test is the SIZING and QUALITY-STEPPING policy — the part that decides how
// big the exported JPEG is — not the browser's encoder.

interface DrawCall {
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number; dw: number; dh: number;
}

let draws: DrawCall[] = [];
let canvasSizes: Array<{ width: number; height: number }> = [];
/** Bytes the fake encoder claims for a given quality. */
let sizeForQuality: (quality: number) => number;
/** Set to true to make toBlob yield null, the "encode failed" path. */
let encodeReturnsNull = false;
/** Set to true to make image loading fail, the HEIC / broken-file path. */
let decodeFails = false;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = "";
  naturalWidth = 4000;
  naturalHeight = 3000;
  set src(_value: string) {
    // Async, like the real thing — a synchronous callback would let the code under
    // test pass even if it never awaited.
    queueMicrotask(() => (decodeFails ? this.onerror?.() : this.onload?.()));
  }
}

beforeEach(() => {
  draws = [];
  canvasSizes = [];
  encodeReturnsNull = false;
  decodeFails = false;
  sizeForQuality = () => 1000;

  vi.stubGlobal("Image", FakeImage);

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    canvasSizes.push({ width: this.width, height: this.height });
    return {
      drawImage: (
        _image: unknown,
        sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number,
      ) => {
        draws.push({ sx, sy, sw, sh, dx, dy, dw, dh });
      },
    } as unknown as CanvasRenderingContext2D;
  });

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    callback: BlobCallback,
    _type?: string,
    quality?: number,
  ) {
    if (encodeReturnsNull) {
      callback(null);
      return;
    }
    const size = sizeForQuality(quality ?? 1);
    // A Blob whose reported size we control; the bytes themselves are irrelevant.
    const blob = new Blob(["x"], { type: "image/jpeg" });
    Object.defineProperty(blob, "size", { value: size });
    callback(blob);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cropToJpegBlob — output sizing", () => {
  it("downscales a large crop to the max edge", async () => {
    await cropToJpegBlob("data:,", { x: 0, y: 0, width: 3000, height: 3000 }, { maxBytes: 5_000_000 });

    // This is the bug the cap exists for: the old version painted 3000×3000 at a
    // fixed quality, which could exceed the 5MB upload gate from a phone photo
    // that was well under it on the way in.
    expect(canvasSizes[0]).toEqual({ width: MAX_CROP_EDGE, height: MAX_CROP_EDGE });
    expect(draws[0].dw).toBe(MAX_CROP_EDGE);
    expect(draws[0].dh).toBe(MAX_CROP_EDGE);
  });

  it("never upscales a crop already below the max edge", async () => {
    await cropToJpegBlob("data:,", { x: 0, y: 0, width: 800, height: 800 }, { maxBytes: 5_000_000 });

    expect(canvasSizes[0]).toEqual({ width: 800, height: 800 });
  });

  it("preserves the crop's aspect while scaling by its longest edge", async () => {
    await cropToJpegBlob("data:,", { x: 0, y: 0, width: 3200, height: 1600 }, { maxBytes: 5_000_000 });

    expect(canvasSizes[0]).toEqual({ width: MAX_CROP_EDGE, height: MAX_CROP_EDGE / 2 });
  });

  it("crops and downscales in a single drawImage pass", async () => {
    await cropToJpegBlob("data:,", { x: 120, y: 240, width: 2000, height: 2000 }, { maxBytes: 5_000_000 });

    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({ sx: 120, sy: 240, sw: 2000, sh: 2000, dx: 0, dy: 0 });
  });

  it("clamps a source rect that runs past the image bounds", async () => {
    // Out-of-bounds source pixels draw as transparent, which a JPEG exports as
    // black — a silent border on the poster rather than an error.
    await cropToJpegBlob("data:,", { x: 3900, y: 2900, width: 500, height: 500 }, { maxBytes: 5_000_000 });

    expect(draws[0].sw).toBe(100); // 4000 - 3900
    expect(draws[0].sh).toBe(100); // 3000 - 2900
  });
});

describe("cropToJpegBlob — byte budget", () => {
  it("returns the first quality that fits the budget", async () => {
    const qualities: number[] = [];
    sizeForQuality = (quality) => {
      qualities.push(quality);
      return quality > 0.8 ? 6_000_000 : 4_000_000;
    };

    const blob = await cropToJpegBlob("data:,", { x: 0, y: 0, width: 2000, height: 2000 }, { maxBytes: 5_000_000 });

    expect(blob.size).toBe(4_000_000);
    // Stops as soon as one fits rather than walking the whole ladder.
    expect(qualities).toEqual([0.86, 0.78]);
  });

  it("does not re-encode when the first quality already fits", async () => {
    const qualities: number[] = [];
    sizeForQuality = (quality) => { qualities.push(quality); return 1_000; };

    await cropToJpegBlob("data:,", { x: 0, y: 0, width: 2000, height: 2000 }, { maxBytes: 5_000_000 });

    expect(qualities).toEqual([0.86]);
  });

  it("returns the smallest attempt when every quality overshoots", async () => {
    // Let the upload's own validation produce the error rather than inventing a
    // second one here.
    sizeForQuality = (quality) => Math.round(quality * 100_000_000);

    const blob = await cropToJpegBlob("data:,", { x: 0, y: 0, width: 2000, height: 2000 }, { maxBytes: 1_000 });

    expect(blob.size).toBe(Math.round(0.5 * 100_000_000));
  });
});

describe("cropToJpegBlob — failures are typed", () => {
  it("throws a decode CropError when the image will not load", async () => {
    // The realistic case: an iPhone HEIC passes the `image/*` gate on the way in
    // but will not decode outside Safari. This used to be an unhandled rejection
    // with no user-visible message at all.
    decodeFails = true;

    await expect(
      cropToJpegBlob("data:,", { x: 0, y: 0, width: 100, height: 100 }, { maxBytes: 5_000_000 }),
    ).rejects.toMatchObject({ name: "CropError", reason: "decode" });
  });

  it("throws an encode CropError when toBlob yields nothing", async () => {
    encodeReturnsNull = true;

    const error = await cropToJpegBlob(
      "data:,",
      { x: 0, y: 0, width: 100, height: 100 },
      { maxBytes: 5_000_000 },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CropError);
    expect((error as CropError).reason).toBe("encode");
  });
});
