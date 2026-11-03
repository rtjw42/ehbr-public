// ── Site footer ──────────────────────────────────────────────────────────────
// Global footer: the primary public contact plus legal links. Footer contacts are
// loaded once and re-fetched on admin save — deliberately not realtime (see the load
// effect's note).
//
// This file is a STATIC import in App.tsx, so whatever it references ships in the
// main bundle on every route. That is why the admin contact editor lives in its own
// lazy, admin-gated module rather than here, and why it must stay that way.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getLegalContent, type LegalCopy } from "@/lib/legal";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { LegalBlocks } from "@/components/LegalCopyRenderer";
import { ContactLinks } from "@/components/ContactLinks";
import {
  loadContacts,
  type ContactFieldType,
  type ContactWithFields,
} from "@/services/contacts";
import { FOOTER_CONTACT_LABEL, linkedContactTypes } from "@/lib/contact-fields";
// Admin-only, so it is BOTH lazy and gated below: `lazy()` alone would still fetch
// the chunk the moment the component mounted, and this footer is on every route.
import { LazyContactsForm, preloadContactsForm } from "@/lib/form-loaders";

type LegalDialogKind = "privacy" | "terms" | null;

export const SiteFooter = () => {
  const { showAdminControls } = useAdmin();
  const { language, t } = useI18n();
  const [contacts, setContacts] = useState<ContactWithFields[]>([]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [legalDialog, setLegalDialog] = useState<LegalDialogKind>(null);
  const legalContent = getLegalContent(language);

  const loadFooterContacts = useCallback(async () => {
    try {
      setContacts(await loadContacts());
    } catch {
      // Keep the global footer quiet on transient contact load failures.
    }
  }, []);

  useEffect(() => {
    // Footer contacts change very rarely, so load once instead of holding an
    // always-on realtime channel for near-static data. An admin editing contacts
    // re-fetches via the contacts form's onSaved.
    void loadFooterContacts();
  }, [loadFooterContacts]);

  const footerContact = useMemo(() => (
    contacts.find((contact) => contact.active !== false && contact.label === FOOTER_CONTACT_LABEL)
    ?? contacts.find((contact) => contact.active !== false)
    ?? null
  ), [contacts]);

  const footerLinks = useMemo(() => (
    (footerContact?.site_contact_fields ?? [])
      .filter((field) => linkedContactTypes.has(field.field_type as ContactFieldType))
  ), [footerContact]);

  return (
    // Footer is a solid dark band. The textured canvas paints the overscroll on every
    // edge by itself, so even this black footer never leaves a black bar past it — the
    // dark stays contained to the footer content, never bleeding into the overscroll.
    <footer className="bg-[hsl(var(--color-footer))] px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] text-center text-[0.68rem] font-medium normal-case tracking-normal text-[hsl(var(--color-footer-foreground))] sm:px-6 sm:text-xs">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-1.5">
        {(footerLinks.length > 0 || showAdminControls) && (
          <div className="relative flex max-w-full items-center justify-center text-[hsl(var(--color-footer-foreground))]/88">
            <div className={cn("flex min-w-0 flex-wrap items-center justify-center gap-x-2.5 gap-y-1", showAdminControls && "px-7")}>
              <span className="text-[hsl(var(--color-footer-foreground))]/78">{t("footer.contactUs")}</span>
              {/* 44px hit box (min touch target) pulled back to the row's 24px with
                  negative margins, so the strip keeps its density and the glyph its
                  16px size — only the tappable area grew. */}
              <ContactLinks
                fields={footerLinks}
                iconClassName="-mx-1.5 -my-2.5 inline-flex h-11 w-11 items-center justify-center text-[hsl(var(--color-footer-foreground))]/88 transition-opacity duration-base hover:opacity-60"
              />
            </div>
            {showAdminControls ? (
              <span className="absolute right-0 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onPointerEnter={preloadContactsForm}
                  onFocus={preloadContactsForm}
                  onClick={() => setManagerOpen(true)}
                  aria-label={t("footer.editContacts")}
                  className="h-6 w-6 rounded-none border-0 bg-transparent p-0 text-[hsl(var(--color-footer-foreground))]/88 transition-opacity duration-base hover:bg-transparent hover:text-[hsl(var(--color-footer-foreground))] hover:opacity-60"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </span>
            ) : null}
          </div>
        )}

        <p className="max-w-3xl leading-relaxed text-[hsl(var(--color-footer-foreground))]/64">{t("footer.disclaimer")}</p>
        {/* Three-column grid rather than a centred flex row: it pins both separators
            to the same x, so the two lines stack as one column instead of drifting
            apart with the text widths either side. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 text-[hsl(var(--color-footer-foreground))]/78">
          <button type="button" className="justify-self-end underline-offset-4 transition-opacity duration-base hover:opacity-60 hover:underline" onClick={() => setLegalDialog("privacy")}>
            {t("footer.privacy")}
          </button>
          <span aria-hidden="true" className="text-[hsl(var(--color-footer-foreground))]/34">//</span>
          <button type="button" className="justify-self-start underline-offset-4 transition-opacity duration-base hover:opacity-60 hover:underline" onClick={() => setLegalDialog("terms")}>
            {t("footer.terms")}
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 text-[hsl(var(--color-footer-foreground))]/54">
          <span className="justify-self-end">{t("footer.releaseVersion")}</span>
          <span aria-hidden="true" className="text-[hsl(var(--color-footer-foreground))]/28">//</span>
          <span className="justify-self-start">{t("footer.copyright", { year: new Date().getFullYear() })}</span>
        </div>
      </div>

      {showAdminControls && (
        <Suspense fallback={null}>
          <LazyContactsForm
            open={managerOpen}
            contact={footerContact}
            onClose={() => setManagerOpen(false)}
            onSaved={() => {
              setManagerOpen(false);
              loadFooterContacts();
            }}
          />
        </Suspense>
      )}
      <LegalDialog copy={legalDialog === "privacy" ? legalContent.privacy : legalContent.terms} open={!!legalDialog} onClose={() => setLegalDialog(null)} />
    </footer>
  );
};


const LegalDialog = ({ copy, open, onClose }: { copy: LegalCopy; open: boolean; onClose: () => void }) => {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-[min(40rem,calc(100vw-1rem))] text-left">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{copy.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4 text-left">
          <p className="text-sm font-medium text-muted-foreground">{copy.updated}</p>
          <LegalBlocks blocks={copy.blocks} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
