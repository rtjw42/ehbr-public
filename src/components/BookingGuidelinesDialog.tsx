// ── Booking guidelines dialog ────────────────────────────────────────────────
// The "read this before you book" gate: house rules plus the right contact (pulled
// from the contacts service). Dismissal is remembered in localStorage so it doesn't
// nag returning users.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Instagram, MessageCircle, Phone, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { LegalBlocks } from "@/components/LegalCopyRenderer";
import { BOOKING_GUIDELINES_DISMISSED_KEY } from "@/lib/booking-guidelines";
import { getLegalContent } from "@/lib/legal";
import { sanitizeDisplayText } from "@/lib/sanitize";
import {
  isExternalContactUrl,
  loadContacts,
  normalizeContactUrl,
  type ContactFieldType,
  type ContactWithFields,
} from "@/services/contacts";
import { useI18n } from "@/hooks/useI18n";

const CONTACT_TYPES = new Set<ContactFieldType>(["instagram", "telegram", "phone", "whatsapp"]);

const contactIconFor = (fieldType: string) => {
  if (fieldType === "instagram") return Instagram;
  if (fieldType === "telegram") return Send;
  if (fieldType === "phone") return Phone;
  if (fieldType === "whatsapp") return MessageCircle;
  return ExternalLink;
};

const contactLabelFor = (fieldType: string, fallback: string) => {
  if (fieldType === "instagram") return "Instagram";
  if (fieldType === "telegram") return "Telegram";
  if (fieldType === "phone") return "Phone";
  if (fieldType === "whatsapp") return "WhatsApp";
  return fallback || "Contact";
};

export const BookingGuidelinesDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [contacts, setContacts] = useState<ContactWithFields[]>([]);
  const [atEnd, setAtEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { language, t } = useI18n();
  const { bookingGuidelines } = getLegalContent(language);

  useEffect(() => {
    if (open) setDontShowAgain(false);
  }, [open]);

  // Read-gate: the "Got it" button only enables once the guidelines are scrolled to
  // the bottom (or the content is too short to scroll). Mirrors the consent gate.
  const SCROLL_THRESHOLD = 12;
  const syncAtEnd = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const reachedEnd =
      node.scrollHeight <= node.clientHeight + SCROLL_THRESHOLD ||
      node.scrollTop + node.clientHeight >= node.scrollHeight - SCROLL_THRESHOLD;
    setAtEnd(reachedEnd);
  }, []);

  useEffect(() => {
    if (!open) return;
    setAtEnd(false);
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = 0;

    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      syncAtEnd();
      secondFrame = window.requestAnimationFrame(syncAtEnd);
    });
    // Content height changes as contacts load in, so watch the scroll box + its
    // children (a plain node observer misses inner growth under a fixed max-height).
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncAtEnd) : null;
    observer?.observe(node);
    Array.from(node.children).forEach((child) => observer?.observe(child));
    window.addEventListener("resize", syncAtEnd);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      observer?.disconnect();
      window.removeEventListener("resize", syncAtEnd);
    };
  }, [open, syncAtEnd]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = async () => {
      try {
        const rows = await loadContacts();
        if (active) setContacts(rows);
      } catch {
        if (active) setContacts([]);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [open]);

  const contactLinks = useMemo(() => (
    contacts
      .filter((contact) => contact.active !== false)
      .flatMap((contact) => contact.site_contact_fields ?? [])
      .filter((field) => CONTACT_TYPES.has(field.field_type as ContactFieldType))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((field) => {
        const cleanValue = sanitizeDisplayText(field.value);
        const cleanLabel = sanitizeDisplayText(field.label);
        return {
          id: field.id,
          href: normalizeContactUrl(cleanValue),
          label: contactLabelFor(field.field_type, cleanLabel),
          opensNewTab: isExternalContactUrl(cleanValue),
          Icon: contactIconFor(field.field_type),
        };
      })
  ), [contacts]);

  const close = useCallback(() => {
    if (dontShowAgain) {
      try {
        window.localStorage.setItem(BOOKING_GUIDELINES_DISMISSED_KEY, "true");
      } catch {
        // Storage may be unavailable; closing still works for this session.
      }
    }
    onOpenChange(false);
  }, [dontShowAgain, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) close();
      else onOpenChange(true);
    }}>
      <DialogContent
        className="max-w-[min(38rem,calc(100vw-1rem))] text-left"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader hideClose>
          <DialogTitle className="text-primary">
            {bookingGuidelines.title}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4" scrollRef={scrollRef} onScroll={syncAtEnd}>
          <p className="text-sm font-medium text-muted-foreground">{bookingGuidelines.intro}</p>
          <LegalBlocks blocks={bookingGuidelines.blocks} />
          <section className="space-y-2 rounded-2xl border bg-background/60 p-3">
            <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary">{t("guidelines.contacts")}</h3>
            {contactLinks.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {contactLinks.map(({ id, href, label, opensNewTab, Icon }) => (
                  <a
                    key={id}
                    href={href}
                    target={opensNewTab ? "_blank" : undefined}
                    rel={opensNewTab ? "noopener noreferrer" : undefined}
                    className="inline-flex items-center gap-2 rounded-full border bg-card/80 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("guidelines.noContacts")}</p>
            )}
          </section>
        </DialogBody>
        <div className="shrink-0 border-t border-border bg-card/95 px-4 py-3 sm:px-6">
          {!atEnd && (
            <p className="mb-2 text-xs text-muted-foreground">{t("consent.scroll")}</p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(event) => setDontShowAgain(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {t("guidelines.dontShow")}
            </Label>
            <Button className="w-full sm:w-auto" disabled={!atEnd} onClick={close}>{t("common.gotIt")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
