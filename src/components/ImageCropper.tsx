import { useCallback, useState } from "react";
import Cropper, { Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCropped: (blob: Blob) => Promise<void> | void;
}

async function getCroppedBlob(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Crop failed"))), "image/jpeg", 0.92)
  );
}

export const ImageCropper = ({ open, imageSrc, onClose, onCropped }: Props) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  const handleSave = async () => {
    if (!imageSrc || !area) return;
    setSaving(true);
    try {
      const blob = await getCroppedBlob(imageSrc, area);
      await onCropped(blob);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="w-[min(calc(100vw-1rem),calc(100%-2rem))] max-w-[min(34rem,calc(100vw-1rem))] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Adjust poster</DialogTitle>
        </DialogHeader>
        <div className="relative h-[min(60svh,32rem)] w-full overflow-hidden rounded-xl bg-black">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          )}
        </div>
        <div className="px-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Zoom</label>
          <Slider min={1} max={3} step={0.01} value={[zoom]} onValueChange={(v) => setZoom(v[0])} />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !area}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
