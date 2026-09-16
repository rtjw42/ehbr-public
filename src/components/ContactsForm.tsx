// ── Contacts form ────────────────────────────────────────────────────────────
// Admin-only editor for the footer's contact links (Instagram, Telegram, email,
// phone, WhatsApp) — up to MAX_CONTACT_FIELDS of them in total, written through
// services/contacts after the admin session is re-verified.
//
// Named `*Form`, not `*Dialog`: the suffix says which shell a modal is built on,
// and this is now `FormShell` (DESIGN_SYSTEM.md → Form System → Placement). It was
// `ContactManagerDialog` while it was still on the raw Radix dialog.
//
// ── What the port changed ────────────────────────────────────────────────────
// 1. THE FIVE ⌄ SECTIONS ARE GONE — deleted, not converted. Five collapsible
//    sections for a list capped at five inputs cost more than they saved, and every
//    network was listed even when empty, so the common case (two links) rendered
//    three sections of nothing. Now only links that EXIST render, as flat rows, and
//    the five networks live inside the Add row's dropdown. This copy never animated
//    its sections (plain `{isOpen && …}`), so removing them removes the pattern
//    rather than porting it — no `Collapse` was ever introduced here.
// 2. A REFUSED SAVE NOW LANDS ON THE PROBLEM. The old message sat at the top of the
//    dialog body and nothing moved to it. `useInvalidFieldFocus` is the shared
//    answer, and it finds its scroll container via `[data-form-body]` — a marker
//    only FormShell sets, which is why this behaviour arrives WITH the shell swap
//    rather than before it.
// 3. The keyboard translates the sheet instead of covering the fields, and the
//    frame no longer resizes — both inherited from FormShell.
//
// Rows are the shared `ui/row-list` shape (icon-in-input + remove), which was
// extracted from the concrete rows this file shipped with once MediaSetlistForm
// had the second shape in hand — abstracting from one example would only have
// guessed at it.
//
// ── Why this is its own file ─────────────────────────────────────────────────
// It used to live inside `SiteFooter.tsx`, and SiteFooter is a static import in
// App.tsx — so this admin form sat in the main bundle, downloaded by every
// anonymous visitor on EVERY route. It is now `lazy()`-imported AND gated on
// `showAdminControls`; both halves are needed, because lazy alone still fetches
// once the component mounts. See DESIGN_SYSTEM.md → Form System.
import { useLayoutEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldRow } from "@/components/ui/field-row";
import { FormField } from "@/components/ui/form-field";
import { FormShell, type FormScreen } from "@/components/ui/form-shell";
import { Input } from "@/components/ui/input";
import { PickerDropdown } from "@/components/ui/picker-dropdown";
import { Row, RowIconInput, RowRemoveButton, newRowUid, useRowFocus } from "@/components/ui/row-list";
import { getErrorMessage } from "@/lib/errors";
import { stripHtmlText } from "@/lib/sanitize";
import type { Translate } from "@/lib/i18n";
import { useAdmin } from "@/hooks/useAdmin";
import { useI18n } from "@/hooks/useI18n";
import { useInvalidFieldFocus } from "@/hooks/useInvalidFieldFocus";
import {
  saveContact,
  type ContactFieldDraft,
  type ContactFieldType,
  type ContactWithFields,
} from "@/services/contacts";
import {
  FOOTER_CONTACT_LABEL,
  FOOTER_CONTACT_TYPES,
  contactFieldIcon,
  contactFieldLabel,
  linkedContactTypes,
  sortContactFieldsByType,
} from "@/lib/contact-fields";

// `uid` (ui/row-list) doubles as the row's key for `useInvalidFieldFocus` (see `save`).
type EditableField = ContactFieldDraft & { uid: string };

const MAX_CONTACT_FIELDS = 5;
const CONTACT_VALUE_MAX_CHARS = 255;

// The list is ONE field, so it gets one id and one error line. The Add row carries
// that id: it is the control the label names, and the only one guaranteed to be on
// screen (rows come and go).
const LIST_FIELD_ID = "contact-links";

const contactFieldPlaceholder = (fieldType: ContactFieldType, t: Translate) => {
  if (fieldType === "instagram") return "@eusoff_band";
  if (fieldType === "telegram") return t("footer.placeholder.telegramHandle");
  if (fieldType === "email") return "name@example.com";
  if (fieldType === "phone") return "+65 8123 4567";
  if (fieldType === "whatsapp") return "+65 8123 4567";
  return "";
};

interface Props {
  open: boolean;
  /** The footer's contact row, or null before one has ever been saved. */
  contact: ContactWithFields | null;
  onClose: () => void;
  onSaved: () => void;
}

export const ContactsForm = ({ open, contact, onClose, onSaved }: Props) => {
  const { ensureAdminSession } = useAdmin();
  const [fields, setFields] = useState<EditableField[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Exactly ONE error exists here ("save at least one link"), so it is a string and
  // not a per-key map. What varies is which control it FOCUSES — see `save`.
  const [error, setError] = useState<string | undefined>(undefined);
  const { t } = useI18n();

  const addAnchor = useRef<HTMLDivElement | null>(null);
  // A refused save scrolls to the first bad field and focuses it — the shared
  // behaviour (DESIGN_SYSTEM → Form System → Failure behaviour). Keys are row uids
  // plus LIST_FIELD_ID for the Add row.
  const { setFieldRef, focusFirstInvalidField } = useInvalidFieldFocus<string>();
  // Both hooks keep their refs private, and a row input has to be reachable by
  // both (focused when freshly added, focused when invalid), so one callback fills
  // both maps.
  const rowFocus = useRowFocus();
  const setRowRef = (uid: string) => (node: HTMLInputElement | null) => {
    rowFocus.setRowRef(uid)(node);
    setFieldRef(uid)(node);
  };

  // useLayoutEffect, NOT useEffect: this form stays mounted between openings, so
  // every field still holds the last session's values when it reopens — a passive
  // effect paints those first and resets a frame later. That matters more now that
  // `saving` is cleared here rather than on save's success path: with a passive
  // effect a reopened form would paint one frame with the button still disabled.
  useLayoutEffect(() => {
    if (!open) return;
    setFields(
      sortContactFieldsByType<EditableField>(
        (contact?.site_contact_fields ?? [])
          .filter((field) => linkedContactTypes.has(field.field_type as ContactFieldType))
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((field, index) => ({
            uid: field.id || newRowUid(),
            id: field.id,
            label: contactFieldLabel(field.field_type, field.label),
            value: field.value,
            field_type: field.field_type as ContactFieldType,
            sort_order: field.sort_order ?? (index + 1) * 10,
          })),
      ),
    );
    // No seeded blank row. The old form opened on an empty Instagram field even for
    // an admin who has never used Instagram — with the network now chosen from the
    // Add row's dropdown, presuming one is just a row to delete.
    setPickerOpen(false);
    setError(undefined);
    setSaving(false);
  }, [contact, open]);

  const addLink = (type: ContactFieldType) => {
    const uid = newRowUid();
    setFields((current) => sortContactFieldsByType([
      ...current,
      { uid, label: contactFieldLabel(type, ""), value: "", field_type: type, sort_order: (current.length + 1) * 10 },
    ]));
    // Not animated in — scrolled to and focused instead (ui/row-list).
    rowFocus.focusRowOnCommit(uid);
    setPickerOpen(false);
    setError(undefined);
  };

  const removeLink = (uid: string) =>
    setFields((current) => current.filter((field) => field.uid !== uid));

  const setLinkValue = (uid: string, value: string) => {
    setFields((current) => current.map((field) => field.uid === uid ? { ...field, value } : field));
    setError(undefined);
  };

  const save = async () => {
    if (saving) return;
    const cleanFields = fields
      .slice(0, MAX_CONTACT_FIELDS)
      .map((field, index) => ({
        ...field,
        label: contactFieldLabel(field.field_type, stripHtmlText(field.label)),
        value: stripHtmlText(field.value),
        sort_order: (index + 1) * 10,
      }))
      // Blank rows are dropped rather than flagged: a row added and thought better
      // of is not a mistake to block on. Only saving NOTHING is refused, below.
      .filter((field) => field.value);

    if (cleanFields.length === 0) {
      const message = t("footer.fieldsRequired");
      setError(message);
      // The list's error, focused on the control that can fix it: the first row's
      // input if there is a row to fill in, else the Add row. Both sit inside the
      // one FormField, so the message is directly beneath either.
      const target = fields[0]?.uid ?? LIST_FIELD_ID;
      focusFirstInvalidField({ [target]: message }, [target]);
      return;
    }

    // `saving` goes up BEFORE the session check, not after. ensureAdminSession is a
    // live network round-trip; on a phone that is a real pause during which the
    // button showed no spinner AND the `if (saving) return` guard did not hold, so
    // a second tap started a second save. Here that was the sharpest version of the
    // bug in the app: saveContact branches `editingId ? update : insert`, so with no
    // contact row yet two taps wrote TWO site_contacts rows.
    setSaving(true);
    try {
      if (!(await ensureAdminSession())) {
        setSaving(false);
        return;
      }
      await saveContact({
        editingId: contact?.id || undefined,
        label: FOOTER_CONTACT_LABEL,
        fields: cleanFields,
        sortOrder: contact?.sort_order ?? 10,
      });
      toast.success(t("footer.updated"));
      onSaved();
      // Deliberately NOT cleared on success: the sheet is exit-animating by now,
      // and repainting the footer button back to its idle label mid-exit is a
      // flicker. The open reset clears it instead.
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : getErrorMessage(error, t("common.couldNotSave")));
      setSaving(false);
    }
  };

  const atMax = fields.length >= MAX_CONTACT_FIELDS;

  const formScreen: FormScreen = {
    key: "form",
    title: t("footer.manageContacts"),
    body: (
      <FormField
        id={LIST_FIELD_ID}
        label={t("footer.fields")}
        // The same counter idiom the text fields use. At 5/5 it is what explains
        // the disabled Add row, so no extra line of prose is needed.
        labelTrailing={t("common.charCounter", { count: fields.length, max: MAX_CONTACT_FIELDS })}
        error={error}
      >
        <div className="space-y-2.5">
          {fields.map((field) => {
            const Icon = contactFieldIcon(field.field_type);
            const network = contactFieldLabel(field.field_type, "");
            return (
              <Row key={field.uid} actions={<RowRemoveButton onClick={() => removeLink(field.uid)} label={t("footer.removeLink", { network })} />}>
                {/* The icon IS the row's label — one label per control, and a
                    repeated network name above every row would be a second text
                    tier for information the icon already carries. The input's
                    accessible name says it in words. */}
                <RowIconInput icon={<Icon />}>
                  <Input
                    ref={setRowRef(field.uid)}
                    value={field.value}
                    onChange={(event) => setLinkValue(field.uid, event.target.value)}
                    maxLength={CONTACT_VALUE_MAX_CHARS}
                    aria-label={network}
                    placeholder={contactFieldPlaceholder(field.field_type, t)}
                  />
                </RowIconInput>
              </Row>
            );
          })}

          {/* Add link — bounded content (five networks), so a dropdown rather than
              a pushed screen. Disabled rather than removed at the cap: a control
              that disappears is a layout change. */}
          <div className="relative" ref={addAnchor}>
            <FieldRow
              id={LIST_FIELD_ID}
              ref={setFieldRef(LIST_FIELD_ID)}
              icon={<Plus className="h-4 w-4" aria-hidden />}
              value={t("footer.addLink")}
              disabled={atMax}
              onClick={() => setPickerOpen((current) => !current)}
            />
            <PickerDropdown
              open={pickerOpen && !atMax}
              onClose={() => setPickerOpen(false)}
              anchorRef={addAnchor}
              ariaLabel={t("footer.chooseNetwork")}
            >
              <div className="space-y-0.5">
                {/* Every network stays listed even once used — MAX_CONTACT_FIELDS
                    is a total, not a per-type cap, so two Instagram links are
                    legitimate and the footer already groups them. */}
                {FOOTER_CONTACT_TYPES.map((type) => {
                  const Icon = contactFieldIcon(type);
                  return (
                    <Button
                      key={type}
                      type="button"
                      variant="ghost"
                      onClick={() => addLink(type)}
                      className="min-h-11 w-full justify-start gap-2.5 px-3"
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {contactFieldLabel(type, "")}
                    </Button>
                  );
                })}
              </div>
            </PickerDropdown>
          </div>
        </div>
      </FormField>
    ),
    footer: (
      <>
        <Button variant="ghost" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </>
    ),
  };

  return (
    <FormShell
      open={open}
      // Guarded here rather than through the screen's `dismissable` flag: that flag
      // also controls whether the close button renders, so toggling it on `saving`
      // would make the header jump the instant Save was pressed.
      onOpenChange={(next) => {
        if (next || saving) return;
        onClose();
      }}
      stack={[formScreen]}
    />
  );
};
