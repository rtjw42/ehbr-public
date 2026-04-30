import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Upload, X } from "lucide-react";
import { EventItem } from "@/lib/events";
import { format } from "date-fns";
import { ImageCropper } from "@/components/ImageCropper";
import { getErrorMessage } from "@/lib/errors";

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: EventItem | null;
  onSaved: () => void;
}

export const EventForm = ({ open, onClose, editing, onSaved }: Props) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("19:00");
  const [endTime, setEndTime] = useState("");
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitle(editing.title);
      setDescription(editing.description ?? "");
      setLocation(editing.location ?? "");
      const ed = new Date(editing.event_date);
      setEventDate(format(ed, "yyyy-MM-dd"));
      setEventTime(format(ed, "HH:mm"));
      setEndTime(editing.end_date ? format(new Date(editing.end_date), "HH:mm") : "");
      setPosterUrl(editing.poster_url);
    } else {
      setTitle(""); setDescription(""); setLocation("");
      setEventDate(format(new Date(), "yyyy-MM-dd"));
      setEventTime("19:00"); setEndTime(""); setPosterUrl(null);
    }
  }, [open, editing]);

  const handleFilePicked = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadBlob = async (blob: Blob) => {
    setUploading(true);
    try {
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await supabase.storage.from("event-posters").upload(path, blob, {
        upsert: false, contentType: "image/jpeg",
      });
      if (error) throw error;
      const { data } = supabase.storage.from("event-posters").getPublicUrl(path);
      setPosterUrl(data.publicUrl);
      toast.success("Poster saved");
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const recropExisting = async () => {
    if (!posterUrl) return;
    try {
      const res = await fetch(posterUrl);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => setCropSrc(reader.result as string);
      reader.readAsDataURL(blob);
    } catch {
      toast.error("Could not load image for cropping");
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !eventDate || !eventTime) {
      toast.error("Title, date and time are required");
      return;
    }
    setSaving(true);
    try {
      const start = new Date(`${eventDate}T${eventTime}:00`);
      const end = endTime ? new Date(`${eventDate}T${endTime}:00`) : null;
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        event_date: start.toISOString(),
        end_date: end?.toISOString() ?? null,
        poster_url: posterUrl,
      };
      if (editing) {
        const { error } = await supabase.from("events").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Event updated");
      } else {
        const { error } = await supabase.from("events").insert(payload);
        if (error) throw error;
        toast.success("Event created");
      }
      onSaved();
      onClose();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[min(90svh,48rem)] w-[min(calc(100vw-1rem),calc(100%-2rem))] max-w-[min(32rem,calc(100vw-1rem))] overflow-x-hidden overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-[clamp(1.5rem,6vw,2rem)]">
            {editing ? "Edit event" : "New event"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="ev-title">Title</Label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer Jam '26" />
          </div>
          <div>
            <Label htmlFor="ev-loc">Location</Label>
            <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="The Underground, 123 Main St" />
          </div>
          <div className="mobile-safe-form-grid grid gap-2 sm:grid-cols-3">
            <div className="min-w-0">
              <Label htmlFor="ev-date">Date</Label>
              <Input id="ev-date" type="date" className="w-full min-w-0 max-w-full" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div className="min-w-0">
              <Label htmlFor="ev-start">Start</Label>
              <Input id="ev-start" type="time" className="w-full min-w-0 max-w-full" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
            </div>
            <div className="min-w-0">
              <Label htmlFor="ev-end">End (optional)</Label>
              <Input id="ev-end" type="time" className="w-full min-w-0 max-w-full" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ev-desc">Description</Label>
            <Textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Lineup, ticket info, vibe…" />
          </div>
          <div>
            <Label>Poster image</Label>
            {posterUrl ? (
              <div className="relative mt-1 group">
                <img src={posterUrl} alt="Poster preview" className="w-full max-h-64 object-cover rounded-xl border" />
                <div className="absolute top-2 right-2 flex gap-2">
                  <button
                    type="button"
                    onClick={recropExisting}
                    className="bg-background/80 backdrop-blur rounded-full px-2.5 py-1 text-xs shadow hover:bg-background"
                  >
                    Adjust
                  </button>
                  <button
                    type="button"
                    onClick={() => setPosterUrl(null)}
                    className="bg-background/80 backdrop-blur rounded-full p-1.5 shadow hover:bg-background"
                    aria-label="Remove poster"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <label className="mt-1 flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl py-8 cursor-pointer hover:bg-accent/40 transition-colors">
                {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{uploading ? "Uploading…" : "Click to upload poster"}</span>
                <input
                  type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePicked(f); e.target.value = ""; }}
                  disabled={uploading}
                />
              </label>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button onClick={handleSave} disabled={saving || uploading} className="w-full sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ImageCropper
        open={!!cropSrc}
        imageSrc={cropSrc}
        onClose={() => setCropSrc(null)}
        onCropped={uploadBlob}
      />
    </Dialog>
  );
};
