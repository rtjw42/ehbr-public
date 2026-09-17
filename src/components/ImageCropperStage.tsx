// ── ImageCropperStage ────────────────────────────────────────────────────────
// The crop surface only — a CONTROLLED component with no dialog of its own. It is
// hosted as a pushed screen on the form's stack (FormShell), so Back pops it, an
// outside tap can't discard the crop, and the footer action lives in the shell's
// own footer alongside every other form action.
//
// Lazy-loaded by its host: react-easy-crop is heavy and only admins editing a
// poster ever need it. Keep this module free of anything the form needs eagerly —
// the pure canvas export lives in `lib/image-crop.ts` for exactly that reason.
//
// The stage is SQUARE: nothing is wasted around a 1:1 crop box, and the surface
// is a token.
import Cropper, { type Area } from "react-easy-crop";

import { MAX_ZOOM, MIN_ZOOM } from "@/lib/image-crop";
import { cn } from "@/lib/utils";

interface Props {
  imageSrc: string;
  crop: { x: number; y: number };
  zoom: number;
  onCropChange: (crop: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  /** Reports the selected region in SOURCE pixels, ready for `cropToJpegBlob`. */
  onAreaChange: (area: Area) => void;
  className?: string;
}

export default function ImageCropperStage({
  imageSrc,
  crop,
  zoom,
  onCropChange,
  onZoomChange,
  onAreaChange,
  className,
}: Props) {
  return (
    <div
      className={cn(
        // Square, and as wide as the form body allows. The crop box is width-bound
        // at 1:1, so this is the largest the crop can be with no leftover surface.
        //
        // The max-width is what keeps the zoom row ABOVE THE FOLD. FormShell's frame
        // is fixed, and on desktop the body is ~528px wide by ~528px tall — a
        // full-width square would fill it exactly and push the zoom control out of
        // view, so you'd have to scroll to zoom. Capping the width leaves room for
        // the controls beneath. Mobile is unaffected: the body is ~342px there, far
        // below this cap.
        "relative mx-auto aspect-square w-full max-w-[26rem] overflow-hidden rounded-[var(--radius-lg)] bg-secondary",
        className,
      )}
    >
      <Cropper
        image={imageSrc}
        crop={crop}
        zoom={zoom}
        aspect={1}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        // Rule-of-thirds guides while dragging — the only in-stage affordance that
        // says "this is adjustable" without adding chrome.
        showGrid
        onCropChange={onCropChange}
        onZoomChange={onZoomChange}
        onCropComplete={(_, pixels) => onAreaChange(pixels)}
      />
    </div>
  );
}
