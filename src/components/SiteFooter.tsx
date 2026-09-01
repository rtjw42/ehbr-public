// ── Site footer ──────────────────────────────────────────────────────────────
// Global footer: the primary public contact plus legal links. Admins get an inline
// contact manager (ContactManagerDialog below). Footer contacts are loaded once and
// re-fetched on admin save — deliberately not realtime (see the load effect's note).
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage } from "@/lib/errors";
import { getLegalContent, type LegalCopy } from "@/lib/legal";
import { stripHtmlText } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { LegalBlocks } from "@/components/LegalCopyRenderer";
import { ContactLinks } from "@/components/ContactLinks";
import {
  loadContacts,
  saveContact,
  type ContactFieldDraft,
  type ContactFieldType,
  type ContactWithFields,
} from "@/services/contacts";
import { FOOTER_CONTACT_TYPES, contactFieldIcon, contactFieldLabel, linkedContactTypes, sortContactFieldsByType } from "@/lib/contact-fields";

// `uid` is a client-only stable key for React reconciliation — keying by array
// index re-binds input state to the wrong field when a middle field is removed.
type EditableField = ContactFieldDraft & { uid: string };

const newFieldUid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `field-${Math.random().toString(36).slice(2)}`);
type LegalDialogKind = "privacy" | "terms" | null;

const MAX_CONTACT_FIELDS = 5;
const FOOTER_CONTACT_LABEL = "Footer links";

const contactFieldPlaceholder = (fieldType: ContactFieldType, t: (key: "footer.placeholder.telegramHandle") => string) => {
  if (fieldType === "instagram") return "@eusoff_band";
  if (fieldType === "telegram") return t("footer.placeholder.telegramHandle");
  if (fieldType === "email") return "name@example.com";
  if (fieldType === "phone") return "+65 8123 4567";
  if (fieldType === "whatsapp") return "+65 8123 4567";
  return "";
};

const emptyFooterContact = (): ContactWithFields => ({
  id: "",
  label: FOOTER_CONTACT_LABEL,
  sort_order: 10,
  active: true,
  created_at: "",
  updated_at: "",
  site_contact_fields: [
    { id: "draft-instagram", contact_id: "", label: "Instagram", value: "", field_type: "instagram", sort_order: 10, created_at: "", updated_at: "" },
  ],
});

export const SiteFooter = () => {
  const { showAdminControls, ensureAdminSession } = useAdmin();
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
    // re-fetches via the manager dialog's onSaved.
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
              <ContactLinks
                fields={footerLinks}
                iconClassName="inline-flex h-6 w-6 items-center justify-center text-[hsl(var(--color-footer-foreground))]/88 transition-opacity duration-base hover:opacity-60"
              />
            </div>
            {showAdminControls ? (
              <span className="absolute right-0 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
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

      <ContactManagerDialog
        open={managerOpen}
        contact={footerContact}
        ensureAdminSession={ensureAdminSession}
        onClose={() => setManagerOpen(false)}
        onSaved={() => {
          setManagerOpen(false);
          loadFooterContacts();
        }}
      />
      <LegalDialog copy={legalDialog === "privacy" ? legalContent.privacy : legalContent.terms} open={!!legalDialog} onClose={() => setLegalDialog(null)} />
    </footer>
  );
};

const ContactManagerDialog = ({
  open,
  contact,
  ensureAdminSession,
  onClose,
  onSaved,
}: {
  open: boolean;
  contact: ContactWithFields | null;
  ensureAdminSession: () => Promise<boolean>;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [fields, setFields] = useState<EditableField[]>([]);
  const [openTypes, setOpenTypes] = useState<Set<ContactFieldType>>(new Set());
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ fields?: string }>({});
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const editing = contact ?? emptyFooterContact();
    const initialFields = sortContactFieldsByType<EditableField>(
      editing.site_contact_fields?.length
        ? editing.site_contact_fields
            .slice()
            .filter((field) => linkedContactTypes.has(field.field_type as ContactFieldType))
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((field, index) => ({
              uid: field.id || newFieldUid(),
              id: field.id,
              label: contactFieldLabel(field.field_type, field.label),
              value: field.value,
              field_type: field.field_type as ContactFieldType,
              sort_order: field.sort_order ?? (index + 1) * 10,
            }))
        : [{ uid: newFieldUid(), label: "Instagram", value: "", field_type: "instagram", sort_order: 10 }],
    );
    setFields(initialFields);
    // Open the social sections that already have links; leave empty ones collapsed.
    setOpenTypes(new Set(initialFields.map((field) => field.field_type)));
    setErrors({});
  }, [contact, open]);

  const toggleType = (type: ContactFieldType) =>
    setOpenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const addLink = (type: ContactFieldType) => {
    setFields((current) => sortContactFieldsByType([
      ...current,
      { uid: newFieldUid(), label: contactFieldLabel(type, ""), value: "", field_type: type, sort_order: (current.length + 1) * 10 },
    ]));
    setOpenTypes((current) => new Set(current).add(type));
    setErrors((current) => ({ ...current, fields: undefined }));
  };

  const removeLink = (uid: string) =>
    setFields((current) => current.filter((field) => field.uid !== uid));

  const setLinkValue = (uid: string, value: string) => {
    setFields((current) => current.map((field) => field.uid === uid ? { ...field, value } : field));
    setErrors((current) => ({ ...current, fields: undefined }));
  };

  const save = async () => {
    if (saving) return;
    if (!(await ensureAdminSession())) return;
    const editing = contact ?? emptyFooterContact();
    const cleanFields = fields
      .slice(0, MAX_CONTACT_FIELDS)
      .map((field, index) => ({
        ...field,
        label: contactFieldLabel(field.field_type, stripHtmlText(field.label)),
        value: stripHtmlText(field.value),
        sort_order: (index + 1) * 10,
      }))
      .filter((field) => field.value);

    if (cleanFields.length === 0) {
      setErrors((current) => ({ ...current, fields: t("footer.fieldsRequired") }));
      return;
    }

    setSaving(true);
    try {
      await saveContact({
        editingId: editing.id || undefined,
        label: FOOTER_CONTACT_LABEL,
        fields: cleanFields,
        sortOrder: editing.sort_order ?? 10,
      });
      toast.success(t("footer.updated"));
      onSaved();
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("common.couldNotSave")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="h-[min(80svh,34rem)] max-w-[min(30rem,calc(100vw-1rem))]">
        <DialogHeader>
          <DialogTitle>{t("footer.manageContacts")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5 text-left">
          <div className="space-y-3">
            <Label>{t("footer.fields")}</Label>
            {errors.fields && <p className="text-xs text-destructive">{errors.fields}</p>}
            {FOOTER_CONTACT_TYPES.map((type) => {
              const Icon = contactFieldIcon(type);
              const typeFields = fields.filter((field) => field.field_type === type);
              const isOpen = openTypes.has(type);
              return (
                <div key={type} className="overflow-hidden rounded-xl border bg-background/60">
                  <button
                    type="button"
                    onClick={() => toggleType(type)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{contactFieldLabel(type, "")}</span>
                      {typeFields.length > 0 && (
                        <span className="type-badge rounded-full bg-muted px-1.5 text-muted-foreground">{typeFields.length}</span>
                      )}
                    </span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && (
                    <div className="space-y-2.5 px-4 pb-4">
                      {typeFields.map((field) => (
                        <div key={field.uid} className="flex items-center gap-2">
                          <Input
                            value={field.value}
                            onChange={(event) => setLinkValue(field.uid, event.target.value)}
                            maxLength={255}
                            placeholder={contactFieldPlaceholder(type, t)}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeLink(field.uid)}
                            aria-label={t("footer.removeField")}
                            className="shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={fields.length >= MAX_CONTACT_FIELDS}
                        onClick={() => addLink(type)}
                      >
                        <Plus className="h-4 w-4" /> {contactFieldLabel(type, "")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter className="gap-3">
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
