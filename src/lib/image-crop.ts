// ── Image cropping ───────────────────────────────────────────────────────────
// Paints a selected source region onto a canvas and exports a JPEG. Pure DOM +
// canvas, no React and no react-easy-crop import — so EventForm can call it from
// its footer without pulling the (heavy, lazy-loaded) cropper stage into the main
// bundle.
//
// The long edge is capped (a poster renders at ~256px; 1600 is generous) and
// quality steps down until the blob fits the byte budget, because re-encoding an
// already-compressed photo at native resolution routinely GROWS it past the 5MB
// upload gate. Decode failure and a null `toBlob` throw a typed CropError the
// caller maps to localized copy — notably HEIC, which only decodes in Safari.

/** The crop rectangle in SOURCE pixels (react-easy-crop's `croppedAreaPixels`). */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropErrorReason = "decode" | "encode";

export class CropError extends Error {
  readonly reason: CropErrorReason;
  constructor(reason: CropErrorReason) {
    super(`image-crop: ${reason}`);
    this.name = "CropError";
    this.reason = reason;
  }
}

/**
 * Longest edge of the exported JPEG. The poster is displayed at `max-h-64` and is
 * only ever shown as a card image, so anything past this is bytes nobody sees.
 */
export const MAX_CROP_EDGE = 1600;

/**
 * Zoom bounds for the crop stage. They live HERE, not in ImageCropperStage: the
 * host needs them for its zoom row, and importing them from the stage module
 * statically would defeat that module's lazy chunk and pull react-easy-crop into
 * the main bundle (rollup warns INEFFECTIVE_DYNAMIC_IMPORT when it happens).
 */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/**
 * Tried in order until one fits the byte budget. Starts below the old fixed 0.92:
 * at 1600px the difference is invisible on a poster and the file is far smaller.
 */
const QUALITY_STEPS = [0.86, 0.78, 0.7, 0.6, 0.5];

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    // Required so the canvas isn't "tainted" — without it toBlob() throws a security
    // error for cross-origin sources (re-cropping an already-uploaded poster reads
    // it back from Supabase storage).
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    // Fires for a genuinely broken file AND for a format the browser can't decode —
    // an iPhone HEIC outside Safari is the realistic case, and it passes the
    // `image/*` gate on the way in.
    image.onerror = () => reject(new CropError("decode"));
    image.src = src;
  });

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new CropError("encode"))),
      "image/jpeg",
      quality,
    );
  });

interface Options {
  /** Hard ceiling for the exported blob; quality steps down until it fits. */
  maxBytes: number;
  maxEdge?: number;
}

export async function cropToJpegBlob(
  src: string,
  area: CropArea,
  { maxBytes, maxEdge = MAX_CROP_EDGE }: Options,
): Promise<Blob> {
  const image = await loadImage(src);

  // react-easy-crop keeps the area inside the media while `restrictPosition` is on
  // (the default), but clamp anyway — drawImage silently produces transparent
  // padding for an out-of-bounds source rect, which exports as black in a JPEG.
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sx = Math.max(0, Math.min(area.x, sourceWidth));
  const sy = Math.max(0, Math.min(area.y, sourceHeight));
  const sw = Math.max(1, Math.min(area.width, sourceWidth - sx));
  const sh = Math.max(1, Math.min(area.height, sourceHeight - sy));

  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new CropError("encode");
  // The source region is drawn straight into the full canvas, so downscaling and
  // cropping happen in one pass.
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);

  let last: Blob | null = null;
  for (const quality of QUALITY_STEPS) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= maxBytes) return blob;
    last = blob;
  }
  // Every step overshot — vanishingly unlikely at 1600px, but returning the
  // smallest attempt lets the upload's own validation produce the error rather
  // than inventing a second one here.
  if (!last) throw new CropError("encode");
  return last;
}
