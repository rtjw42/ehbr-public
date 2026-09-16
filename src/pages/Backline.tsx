// ── Backline (/backline) ─────────────────────────────────────────────────────
// Public Gear & Rates page. Each section renders inline text or a downloadable
// PDF/image pulled from the backline service. Realtime on backline_content keeps it
// live.
//
// This page is PUBLIC, so it holds only what a visitor needs: the cards and their
// skeleton. The admin editor is `components/BacklineForm.tsx` — lazy-imported and
// gated on `showAdminControls`, so an anonymous visitor never downloads it.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Download, ExternalLink, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { useAdmin } from "@/hooks/useAdmin";
import { crossfadeTransition, overlayExitTransition } from "@/lib/motion";
import { FadeInImg } from "@/components/FadeInImg";
import { backlineSectionLabel } from "@/lib/backline-labels";
import { sanitizeDisplayText } from "@/lib/sanitize";

import {
  DEFAULT_BACKLINE_CONTENT,
  downloadBacklineFile as downloadBacklineBlob,
  downloadFileNameForContent,
  loadBacklineContent,
  type BacklineContent,
  type SectionKey,
} from "@/services/backline";
import { BacklineSkeleton } from "@/components/PageSkeletons";
import { useI18n } from "@/hooks/useI18n";
import { PageShell } from "@/components/PageShell";
import { PageHeaderBar } from "@/components/PageHeaderBar";
import type { Translate } from "@/lib/i18n";
// Admin-only, so it is BOTH lazy and gated below: `lazy()` alone would still fetch
// the chunk the moment the component mounted, and this page is public.
import { LazyBacklineForm, preloadBacklineForm } from "@/lib/form-loaders";

const Backline = () => {
  const [content, setContent] = useState<Record<SectionKey, BacklineContent>>(DEFAULT_BACKLINE_CONTENT);
  const [previewUrls, setPreviewUrls] = useState<Record<SectionKey, string>>({ gear: "", rates: "" });
  const [previewFailures, setPreviewFailures] = useState<Record<SectionKey, boolean>>({ gear: false, rates: false });
  const { showAdminControls } = useAdmin();
  // Two states, not one: `editing` says WHICH section, `formOpen` says whether the
  // sheet is up. Folding them into one meant the form lost its section the instant
  // it closed, and it had to hold a copy in a ref to render the way out.
  const [editing, setEditing] = useState<BacklineContent | null>(null);
  const [formOpen, setFormOpen] = useState(false);
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
                      onEdit={() => {
                        setEditing(item);
                        setFormOpen(true);
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {showAdminControls && (
        <Suspense fallback={null}>
          <LazyBacklineForm
            open={formOpen}
            section={editing}
            // The page already holds a decoded object URL for every section's file,
            // so the form can preview an existing image without a second download.
            previewUrl={editing ? previewUrls[editing.section_key as SectionKey] : ""}
            onClose={() => setFormOpen(false)}
            onSaved={() => {
              setFormOpen(false);
              loadContent();
            }}
          />
        </Suspense>
      )}

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
              onPointerEnter={preloadBacklineForm}
              onFocus={preloadBacklineForm}
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

const downloadBacklineFile = async (item: BacklineContent, t: Translate) => {
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

export default Backline;
