import { useCallback, useState, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type FadeInImgProps = ImgHTMLAttributes<HTMLImageElement> & {
  /**
   * Resting opacity once the image has loaded. Defaults to 1; pass a lower value
   * (e.g. 0.88 for the vinyl tint) to fade up to a partial opacity.
   */
  loadedOpacity?: number;
};

/**
 * Image that fades from transparent to its resting opacity as it decodes, so a
 * late-arriving network image settles in rather than popping and shifting the
 * eye. The fade is load-quality (not decorative), so it is always on — including
 * mobile.
 *
 * Cached images report `complete` the instant the element mounts; we detect that
 * synchronously via a callback ref and render them at full opacity with NO
 * transition, so a hot image never flashes from zero. The fade transition is
 * only attached on the async path (after `onLoad`), so the cached jump is
 * instantaneous.
 *
 * The caller owns layout: keep this inside a fixed-size container so filling the
 * image never reflows the page.
 */
export const FadeInImg = ({
  loadedOpacity = 1,
  className,
  style,
  onLoad,
  ...props
}: FadeInImgProps) => {
  // "pending"  → not yet loaded, opacity 0, no transition
  // "fading"   → decoded asynchronously, transition opacity 0 → rest
  // "shown"    → already cached on mount, jump straight to rest, no transition
  const [status, setStatus] = useState<"pending" | "fading" | "shown">("pending");

  const measureRef = useCallback((node: HTMLImageElement | null) => {
    // A cached/already-decoded image is `complete` with real dimensions the
    // moment the node exists — resolve it before first paint so it never fades.
    if (node?.complete && node.naturalWidth > 0) {
      setStatus((current) => (current === "pending" ? "shown" : current));
    }
  }, []);

  return (
    <img
      ref={measureRef}
      className={cn(status === "fading" && "img-fade", className)}
      style={{ ...style, opacity: status === "pending" ? 0 : loadedOpacity }}
      onLoad={(event) => {
        setStatus((current) => (current === "shown" ? current : "fading"));
        onLoad?.(event);
      }}
      {...props}
    />
  );
};
