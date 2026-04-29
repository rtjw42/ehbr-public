import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Image as ImageIcon, Loader2, Pencil, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SiteNav } from "@/components/SiteNav";
import { Reveal } from "@/components/Reveal";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import type { Session } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";

type BacklineContent = Tables<"backline_content">;
type SectionKey = "gear" | "rates";
type ContentType = "pdf" | "image" | "text";

const SECTION_LABELS: Record<SectionKey, string> = {
  gear: "Gear",
  rates: "Rates",
};

const DEFAULT_CONTENT: Record<SectionKey, BacklineContent> = {
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

const Backline = () => {
  const [content, setContent] = useState<Record<SectionKey, BacklineContent>>(DEFAULT_CONTENT);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState<BacklineContent | null>(null);

  const sections = useMemo(() => [content.gear, content.rates], [content]);

  const loadContent = async () => {
    const { data, error } = await supabase
      .from("backline_content")
      .select("*")
      .in("section_key", ["gear", "rates"]);

    if (error) {
      toast.error(error.message);
      return;
    }

    const next = { ...DEFAULT_CONTENT };
    data?.forEach((item) => {
      if (item.section_key === "gear" || item.section_key === "rates") {
        next[item.section_key] = item;
      }
    });
    setContent(next);
  };

  useEffect(() => {
    loadContent();
    const ch = supabase
      .channel("backline-content-public")
      .on("postgres_changes", { event: "*", schema: "public", table: "backline_content" }, () => loadContent())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    const check = async (session: Session | null) => {
      if (!session) {
        setIsAdmin(false);
        return;
      }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", session.user.id);
      setIsAdmin(!!data?.some((r) => r.role === "admin"));
    };
    supabase.auth.getSession().then(({ data: { session } }) => check(session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setTimeout(() => check(session), 0));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="app-page-bg relative min-h-screen overflow-hidden page-transition">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[8%] top-[8%] h-[clamp(11rem,32vw,20rem)] w-[clamp(11rem,32vw,20rem)] rounded-full bg-primary/10 animate-float-slow" />
        <div className="absolute right-[4%] top-[22%] h-[clamp(7rem,22vw,13rem)] w-[clamp(7rem,22vw,13rem)] rotate-12 bg-[hsl(190_60%_45%/0.12)] animate-float-slower" />
        <div className="absolute bottom-[10%] left-[28%] h-0 w-0 border-l-[clamp(3rem,10vw,6rem)] border-r-[clamp(3rem,10vw,6rem)] border-b-[clamp(5rem,16vw,10rem)] border-l-transparent border-r-transparent border-b-[hsl(45_85%_55%/0.14)]" />
      </div>
      <SiteNav />

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-16">
        <section className="hero-enter border-b pb-8">
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(3rem,13vw,5rem)] text-primary leading-none">Backline</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              View our gear and rates. Each section can be shared as text, an image, or a downloadable PDF.
            </p>
          </div>
        </section>

        <section className="py-8 sm:py-10">
          <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
            <div className="grid auto-cols-[minmax(18rem,85vw)] grid-flow-col gap-4 lg:auto-cols-fr lg:grid-flow-row lg:grid-cols-2">
              {sections.map((item, index) => (
                <Reveal key={item.section_key} delay={index * 70}>
                  <BacklineContentCard item={item} isAdmin={isAdmin} onEdit={() => setEditing(item)} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      </main>

      <BacklineContentDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          loadContent();
        }}
      />
    </div>
  );
};

const BacklineContentCard = ({
  item,
  isAdmin,
  onEdit,
}: {
  item: BacklineContent;
  isAdmin: boolean;
  onEdit: () => void;
}) => {
  const publicUrl = item.file_path
    ? supabase.storage.from("backline-documents").getPublicUrl(item.file_path).data.publicUrl
    : "";
  const isPdf = item.content_type === "pdf";
  const isImage = item.content_type === "image";

  return (
    <article className="flex h-full min-h-[24rem] flex-col rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
            {SECTION_LABELS[item.section_key as SectionKey] ?? item.section_key}
          </div>
          <h2 className="mt-2 break-words font-display text-[clamp(2rem,8vw,3rem)] text-primary leading-none">
            {item.title}
          </h2>
        </div>
        {isAdmin && (
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Edit ${item.title}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="mt-5 flex flex-1 flex-col">
        {isPdf && publicUrl ? (
          <div className="flex flex-1 flex-col rounded-xl border bg-background/60 p-3">
            <div className="min-h-[clamp(24rem,70svh,42rem)] flex-1 overflow-y-auto rounded-lg border bg-background" data-lenis-prevent>
              <iframe
                src={`${publicUrl}#toolbar=0&navpanes=0`}
                title={item.title}
                className="h-[clamp(24rem,70svh,42rem)] w-full"
              />
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button asChild className="w-full sm:w-auto">
                <a href={publicUrl} download>
                  <Download className="h-4 w-4" /> Download
                </a>
              </Button>
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" /> Open
                </a>
              </Button>
            </div>
          </div>
        ) : isImage && publicUrl ? (
          <div className="space-y-3">
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl border bg-background">
              <img src={publicUrl} alt={item.title} className="max-h-[clamp(22rem,68svh,40rem)] w-full object-contain" />
            </a>
            <Button asChild variant="outline" className="w-full">
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Open image
              </a>
            </Button>
          </div>
        ) : (
          <div className="flex-1 whitespace-pre-wrap rounded-xl border bg-background/60 p-4 text-sm leading-relaxed text-foreground/80">
            {item.body_text || "No content added yet."}
          </div>
        )}
      </div>
    </article>
  );
};

const BacklineContentDialog = ({
  editing,
  onClose,
  onSaved,
}: {
  editing: BacklineContent | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentType>("text");
  const [bodyText, setBodyText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setContentType(editing.content_type as ContentType);
    setBodyText(editing.body_text ?? "");
    setFile(null);
  }, [editing]);

  const save = async () => {
    if (!editing) return;
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (contentType === "text" && !bodyText.trim()) {
      toast.error("Text content is required");
      return;
    }
    if (contentType !== "text" && !file && !editing.file_path) {
      toast.error("Upload a PDF or image first");
      return;
    }

    setSaving(true);
    try {
      let filePath = contentType === "text" ? null : editing.file_path;
      let fileName = contentType === "text" ? null : editing.file_name;
      let mimeType = contentType === "text" ? null : editing.mime_type;

      if (file && contentType !== "text") {
        if (contentType === "pdf" && file.type !== "application/pdf") {
          throw new Error("Please upload a PDF file");
        }
        if (contentType === "image" && !file.type.startsWith("image/")) {
          throw new Error("Please upload an image file");
        }

        const ext = file.name.split(".").pop() || (contentType === "pdf" ? "pdf" : "jpg");
        filePath = `${editing.section_key}/${Date.now()}.${ext}`;
        fileName = file.name;
        mimeType = file.type;

        const { error: uploadError } = await supabase.storage.from("backline-documents").upload(filePath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: true,
        });
        if (uploadError) throw uploadError;
      }

      const { error } = await supabase.from("backline_content").upsert({
        section_key: editing.section_key,
        title: title.trim(),
        content_type: contentType,
        body_text: contentType === "text" ? bodyText.trim() : null,
        file_path: filePath,
        file_name: fileName,
        mime_type: mimeType,
      }, { onConflict: "section_key" });

      if (error) throw error;
      toast.success(`${title.trim()} updated`);
      onSaved();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!editing} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[min(90svh,42rem)] w-[min(calc(100vw-1rem),calc(100%-2rem))] max-w-[min(30rem,calc(100vw-1rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {editing?.section_key ? SECTION_LABELS[editing.section_key as SectionKey] : "Backline content"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="backline-title">Title</Label>
            <Input id="backline-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Content type</Label>
            <Select value={contentType} onValueChange={(value: ContentType) => { setContentType(value); setFile(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="image">Image</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {contentType === "text" ? (
            <div className="space-y-1.5">
              <Label htmlFor="backline-text">Text</Label>
              <Textarea
                id="backline-text"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={8}
                placeholder="Paste the gear list or rates here"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="backline-file">{contentType === "pdf" ? "PDF" : "Image"}</Label>
              <Input
                id="backline-file"
                type="file"
                accept={contentType === "pdf" ? "application/pdf" : "image/*"}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                {file?.name || editing?.file_name || "No file selected"}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default Backline;
