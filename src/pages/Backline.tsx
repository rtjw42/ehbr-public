// ── Backline (/backline) ─────────────────────────────────────────────────────
// Public Gear & Rates page. Each section renders inline text or a downloadable
// PDF/image pulled from the backline service; admins can edit inline. Realtime on
// backline_content keeps it live.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Download, ExternalLink, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { useAdmin } from "@/hooks/useAdmin";
import { crossfadeTransition, overlayExitTransition } from "@/lib/motion";
import { FadeInImg } from "@/components/FadeInImg";
import { assertBacklineFile, fileValidationTranslationKey } from "@/lib/file-validation";
import { sanitizeDisplayText, stripHtmlText } from "@/lib/sanitize";

import {
  DEFAULT_BACKLINE_CONTENT,
  downloadBacklineFile as downloadBacklineBlob,
  downloadFileNameForContent,
  loadBacklineContent,
  saveBacklineContent,
  uploadBacklineFile,
  type BacklineContent,
  type BacklineContentType,
  type BacklineFileMetadata,
  type SectionKey,
} from "@/services/backline";
import { BacklineSkeleton } from "@/components/PageSkeletons";
import { useI18n } from "@/hooks/useI18n";
import { PageShell } from "@/components/PageShell";
import { PageHeaderBar } from "@/components/PageHeaderBar";
import type { TranslationKey } from "@/lib/i18n";

type TFunction = (key: TranslationKey, vars?: Record<string, string | number>) => string;
const BACKLINE_TITLE_MAX_CHARS = 255;
const BACKLINE_BODY_MAX_CHARS = 5000;

const backlineSectionLabel = (sectionKey: string, t: TFunction) => {
  if (sectionKey === "gear") return t("backline.section.gear");
  if (sectionKey === "rates") return t("backline.section.rates");
  return sectionKey;
};

const Backline = () => {
  const [content, setContent] = useState<Record<SectionKey, BacklineContent>>(DEFAULT_BACKLINE_CONTENT);
  const [previewUrls, setPreviewUrls] = useState<Record<SectionKey, string>>({ gear: "", rates: "" });
  const [previewFailures, setPreviewFailures] = useState<Record<SectionKey, boolean>>({ gear: false, rates: false });
  const { showAdminControls, ensureAdminSession } = useAdmin();
  const [editing, setEditing] = useState<BacklineContent | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [previewsReady, setPreviewsReady] = useState(false);
  const previewUrlsRef = useRef<Record<SectionKey, string>>({ gear: "", rates: "" });
  const loadIdRef = useRef(0);
  const { t } = useI18n();

  const sections = useMemo(() => [content.gear, content.rates], [content]);

  const revokePreviewUrls = useCallback(() => {
    Object.values(previewUrlsRef.current).forEach((href) => {
      if (href) URL.revokeObjectURL(href);
    });
    previewUrlsRef.current = { gear: "", rates: "" };
  }, []);

  const preloadPreviews = useCallback(async (nextContent: Record<SectionKey, BacklineContent>) => {
    const nextUrls: Record<SectionKey, string> = { gear: "", rates: "" };
    const nextFailures: Record<SectionKey, boolean> = { gear: false, rates: false };
    const preloadable = (Object.keys(nextContent) as SectionKey[]).map(async (sectionKey) => {
      const item = nextContent[sectionKey];
      if (!item.file_path || (item.content_type !== "pdf" && item.content_type !== "image")) return;
      try {
        const data = await downloadBacklineBlob(item.file_path);
        if (!data) {
          nextFailures[sectionKey] = true;
          return;
        }
        nextUrls[sectionKey] = URL.createObjectURL(data);
      } catch {
        nextFailures[sectionKey] = true;
      }
    });

    await Promise.allSettled(preloadable);
    return { nextUrls, nextFailures };
  }, []);

  const loadContent = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    try {
      const nextContent = await loadBacklineContent();
      if (loadId !== loadIdRef.current) return;
      setContent(nextContent);
      setPreviewsReady(false);
      void preloadPreviews(nextContent).then(({ nextUrls, nextFailures }) => {
        if (loadId !== loadIdRef.current) {
          Object.values(nextUrls).forEach((href) => {
            if (href) URL.revokeObjectURL(href);
          });
          return;
        }
        revokePreviewUrls();
        previewUrlsRef.current = nextUrls;
        setPreviewUrls(nextUrls);
        setPreviewFailures(nextFailures);
        setPreviewsReady(true);
      });
    } catch (error: unknown) {
      if (loadId === loadIdRef.current) setPreviewsReady(true);
      toast.error(getErrorMessage(error, t("backline.loadFailed")));
    }
  }, [preloadPreviews, revokePreviewUrls, t]);

  useEffect(() => () => revokePreviewUrls(), [revokePreviewUrls]);

  useEffect(() => {
    let active = true;
    void loadContent().finally(() => {
      if (active) setInitialLoading(false);
    });
    const ch = supabase
      .channel("backline-content-public")
      .on("postgres_changes", { event: "*", schema: "public", table: "backline_content" }, () => loadContent())
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [loadContent]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadContent();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadContent]);

  return (
    <PageShell className="text-foreground">
      <PageHeaderBar title={t("common.pageBackline")}>
        <p className="mt-2 max-w-xl text-sm font-medium leading-relaxed text-muted-foreground sm:text-base">
          {t("backline.summary")}
        </p>
      </PageHeaderBar>
      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <section className="pb-12 sm:pb-16">
          <AnimatePresence mode="wait" initial={false}>
            {initialLoading ? (
              <motion.div key="skeleton" exit={{ opacity: 0 }} transition={overlayExitTransition}>
                <BacklineSkeleton />
              </motion.div>
            ) : (
              <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={crossfadeTransition}>
                {/* Fixed 2-card layout — fade the block in together (no per-card
                    cascade): with only two known cards a cascade adds nothing and
                    its desktop-only gating made the cards hard-pop in on mobile. */}
                <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
                  {sections.map((item) => (
                    <BacklineContentCard
                      key={item.section_key}
                      item={item}
                      objectUrl={previewUrls[item.section_key as SectionKey]}
                      previewFailed={previewFailures[item.section_key as SectionKey]}
                      previewsReady={previewsReady}
                      isAdmin={showAdminControls}
                      onEdit={() => setEditing(item)}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      <BacklineContentDialog
        editing={editing}
        ensureAdminSession={ensureAdminSession}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          loadContent();
        }}
      />
    </PageShell>
  );
};

const BacklineContentCard = ({
  item,
  objectUrl,
  previewFailed,
  previewsReady,
  isAdmin,
  onEdit,
}: {
  item: BacklineContent;
  objectUrl: string;
  previewFailed: boolean;
  previewsReady: boolean;
  isAdmin: boolean;
  onEdit: () => void;
}) => {
  const [textExpanded, setTextExpanded] = useState(false);
  // Iframes paint white until their document arrives — fade the PDF preview in
  // on load so dark mode never flashes a white box.
  const [pdfReady, setPdfReady] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    setPdfReady(false);
  }, [objectUrl]);
  const isPdf = item.content_type === "pdf";
  const isImage = item.content_type === "image";
  const isFilePreview = isPdf || isImage;
  const hasFileActions = isFilePreview;
  const cleanBodyText = sanitizeDisplayText(item.body_text) || t("backline.noContent");
  const shouldClampText = item.content_type === "text" && cleanBodyText.length > 420;

  useEffect(() => {
    setTextExpanded(false);
  }, [item.id, item.updated_at, item.body_text]);

  const viewInNewTab = () => {
    if (!objectUrl) return;
    window.open(objectUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <article className="group flex flex-col overflow-hidden rounded-[2rem] p-4 text-foreground shadow-sm frost-panel dark:shadow-none sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {backlineSectionLabel(item.section_key, t)}
          </div>
          <h2 className="type-section mt-2 break-words text-foreground">
            {sanitizeDisplayText(item.title)}
          </h2>
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center">
          {isAdmin && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onEdit}
              aria-label={t("backline.editAria", { title: sanitizeDisplayText(item.title) })}
              className="rounded-full"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {hasFileActions && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={viewInNewTab} disabled={!previewsReady || !objectUrl} className="w-full rounded-full border-foreground/25 bg-transparent text-foreground hover:bg-foreground/10 hover:text-foreground sm:w-auto">
            <ExternalLink className="h-4 w-4" /> {t("common.view")}
          </Button>
          <Button
            type="button"
            onClick={() => void downloadBacklineFile(item, t)}
            disabled={!previewsReady}
            className="btn-on-glass w-full rounded-full sm:w-auto"
          >
            <Download className="h-4 w-4" /> {t("common.download")}
          </Button>
        </div>
      )}

      <div className="relative mt-5">
        {!previewsReady ? (
          <BacklinePreviewPlaceholder />
        ) : (
        <div aria-busy={!previewsReady}>
          {isPdf && objectUrl ? (
            <div className="rounded-[1.5rem] bg-foreground/[0.05] p-3">
              <div className="h-[16rem] overflow-y-auto overscroll-contain rounded-[1.1rem] bg-card dark:bg-card/60 sm:h-[18rem]">
                <iframe
                  key={objectUrl}
                  src={`${objectUrl}#toolbar=0&navpanes=0`}
                  title={sanitizeDisplayText(item.title)}
                  onLoad={() => setPdfReady(true)}
                  className={`h-full w-full transition-opacity duration-base ${pdfReady ? "opacity-100" : "opacity-0"}`}
                />
              </div>
            </div>
          ) : isImage && objectUrl ? (
            <div className="flex h-[16rem] overflow-hidden rounded-[1.5rem] bg-foreground/[0.05] sm:h-[18rem]">
              {/* Fade the preview in over the placeholder so the image swap settles instead of popping. */}
              <FadeInImg src={objectUrl} alt={sanitizeDisplayText(item.title)} className="h-full w-full object-contain" />
            </div>
          ) : previewFailed ? (
            <div className="grid h-[10rem] place-items-center rounded-[1.5rem] bg-foreground/[0.05] p-4 text-center text-sm font-medium text-muted-foreground">
              {t("backline.previewUnavailable")}
            </div>
          ) : (
            <div className="flex flex-col rounded-[1.5rem] bg-foreground/[0.05] p-5">
              <div
                className={`whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-foreground/80 ${
                  textExpanded ? "max-h-[20rem] overflow-y-auto overscroll-contain pr-1" : "overflow-hidden"
                }`}
              >
                {shouldClampText && !textExpanded ? `${cleanBodyText.slice(0, 420).trimEnd()}...` : cleanBodyText}
              </div>
              {shouldClampText && (
                <button
                  type="button"
                  onClick={() => setTextExpanded((current) => !current)}
                  className="mt-4 inline-flex min-h-9 items-center justify-center gap-1.5 self-start rounded-full border border-foreground/20 px-3 text-xs font-semibold text-foreground transition-colors duration-fast hover:bg-foreground/10"
                  aria-expanded={textExpanded}
                >
                  {textExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {textExpanded ? t("backline.showLess") : t("backline.showMore")}
                </button>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </article>
  );
};

const BacklinePreviewPlaceholder = () => (
  <div className="flex h-[16rem] flex-col rounded-[1.5rem] bg-foreground/[0.05] p-4 sm:h-[18rem]">
    <div className="skeleton-block h-full rounded-[1.1rem]" />
  </div>
);

const downloadBacklineFile = async (item: BacklineContent, t: TFunction) => {
  if (!item.file_path) return;
  try {
    const data = await downloadBacklineBlob(item.file_path);
    if (!data) return;
    const href = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = downloadFileNameForContent(item);
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  } catch (error: unknown) {
    toast.error(getErrorMessage(error, t("backline.downloadFailed")));
  }
};

const BacklineContentDialog = ({
  editing,
  ensureAdminSession,
  onClose,
  onSaved,
}: {
  editing: BacklineContent | null;
  ensureAdminSession: () => Promise<boolean>;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<BacklineContentType>("text");
  const [bodyText, setBodyText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; bodyText?: string; file?: string }>({});
  const { t } = useI18n();

  useEffect(() => {
    if (!editing) return;
    setTitle(editing.title);
    setContentType(editing.content_type as BacklineContentType);
    setBodyText(editing.body_text ?? "");
    setFile(null);
    setErrors({});
  }, [editing]);

  const save = async () => {
    if (saving) return;
    if (!editing) return;
    if (!(await ensureAdminSession())) return;
    const cleanTitle = stripHtmlText(title);
    const cleanBodyText = stripHtmlText(bodyText);
    const nextErrors = {
      title: cleanTitle ? undefined : t("validation.titleRequired"),
      bodyText: contentType === "text" && !cleanBodyText ? t("validation.textContentRequired") : undefined,
      file: contentType !== "text" && !file && !editing.file_path ? t("validation.fileRequired") : undefined,
    };
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.bodyText || nextErrors.file) {
      return;
    }

    setSaving(true);
    try {
      let filePath = contentType === "text" ? null : editing.file_path;
      let fileName = contentType === "text" ? null : editing.file_name;
      let mimeType = contentType === "text" ? null : editing.mime_type;

      if (file && contentType !== "text") {
        assertBacklineFile(file, contentType);

        const metadata = await uploadBacklineFile({
          sectionKey: editing.section_key as SectionKey,
          contentType,
          file,
        });
        filePath = metadata.filePath;
        fileName = metadata.fileName;
        mimeType = metadata.mimeType;
      }

      const fileMetadata: BacklineFileMetadata | null = contentType === "text" || !filePath
        ? null
        : { filePath, fileName, mimeType };
      await saveBacklineContent({
        sectionKey: editing.section_key as SectionKey,
        title,
        contentType,
        bodyText,
        fileMetadata,
      });
      toast.success(t("backline.saved"));
      onSaved();
    } catch (error: unknown) {
      const validationKey = fileValidationTranslationKey(error);
      toast.error(error instanceof TypeError ? t("common.networkIssue") : validationKey ? t(validationKey) : getErrorMessage(error, t("backline.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!editing} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-[min(30rem,calc(100vw-1rem))]">
        <DialogHeader>
          <DialogTitle>{t("backline.editTitle", { section: editing?.section_key ? backlineSectionLabel(editing.section_key, t) : t("backline.contentFallback") })}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="backline-title">{t("backline.formTitle")}</Label>
              <span className="shrink-0 type-chip text-muted-foreground tabular-nums">
                {t("backline.charCounter", { count: title.length, max: BACKLINE_TITLE_MAX_CHARS })}
              </span>
            </div>
            <Input
              id="backline-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErrors((current) => ({ ...current, title: undefined }));
              }}
              maxLength={BACKLINE_TITLE_MAX_CHARS}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? "backline-title-error" : undefined}
            />
            {errors.title && <p id="backline-title-error" className="text-xs text-destructive">{errors.title}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t("backline.contentType")}</Label>
            <Select value={contentType} onValueChange={(value: BacklineContentType) => { setContentType(value); setFile(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t("backline.text")}</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="image">{t("backline.image")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {contentType === "text" ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="backline-text">{t("backline.text")}</Label>
                <span className="shrink-0 type-chip text-muted-foreground tabular-nums">
                  {t("backline.charCounter", { count: bodyText.length, max: BACKLINE_BODY_MAX_CHARS })}
                </span>
              </div>
              <Textarea
                id="backline-text"
                className="min-h-40 resize-none"
                value={bodyText}
                onChange={(e) => {
                  setBodyText(e.target.value);
                  setErrors((current) => ({ ...current, bodyText: undefined }));
                }}
                maxLength={BACKLINE_BODY_MAX_CHARS}
                placeholder={t("backline.textPlaceholder")}
                aria-invalid={!!errors.bodyText}
                aria-describedby={errors.bodyText ? "backline-text-error" : undefined}
              />
              {errors.bodyText && <p id="backline-text-error" className="text-xs text-destructive">{errors.bodyText}</p>}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="backline-file">{contentType === "pdf" ? "PDF" : t("backline.image")}</Label>
              <Input
                id="backline-file"
                type="file"
                accept={contentType === "pdf" ? "application/pdf" : "image/*"}
                onChange={(e) => {
                  const nextFile = e.target.files?.[0] ?? null;
                  if (!nextFile) {
                    setFile(null);
                    return;
                  }
                  try {
                    assertBacklineFile(nextFile, contentType);
                    setFile(nextFile);
                    setErrors((current) => ({ ...current, file: undefined }));
                  } catch (error: unknown) {
                    setFile(null);
                    e.target.value = "";
                    const validationKey = fileValidationTranslationKey(error);
                    setErrors((current) => ({ ...current, file: validationKey ? t(validationKey) : getErrorMessage(error, t("validation.fileInvalid")) }));
                  }
                }}
                aria-invalid={!!errors.file}
                aria-describedby={errors.file ? "backline-file-error" : undefined}
              />
              <p className="text-xs text-muted-foreground">
                {sanitizeDisplayText(file?.name || editing?.file_name) || t("backline.noFile")}
              </p>
              {errors.file && <p id="backline-file-error" className="text-xs text-destructive">{errors.file}</p>}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default Backline;
