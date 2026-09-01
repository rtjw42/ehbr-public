// ── Contacts service ─────────────────────────────────────────────────────────
// The footer / About contact cards and their per-field links. Reads are public;
// writes assume the caller has already verified a live admin session (RLS enforces
// it). The bulk of this file is link normalization: turning whatever an admin types
// (a handle, a bare number, a full URL) into a canonical, safe href per field type.
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { stripHtmlText } from "@/lib/sanitize";
import { isValidEmail } from "@/lib/validation";

// ── Types ────────────────────────────────────────────────────────────────────
export type SiteContact = Tables<"site_contacts">;
export type SiteContactField = Tables<"site_contact_fields">;
export type ContactFieldType = "text" | "link" | "instagram" | "telegram" | "email" | "phone" | "whatsapp";
export type ContactWithFields = SiteContact & { site_contact_fields?: SiteContactField[] };

export type ContactFieldDraft = {
  id?: string;
  label: string;
  value: string;
  field_type: ContactFieldType;
  sort_order: number;
};

export type SaveContactInput = {
  editingId?: string;
  label: string;
  fields: ContactFieldDraft[];
  sortOrder: number;
};

type ContactPayload = {
  label: string;
  sort_order: number;
  active: true;
};

type ContactFieldRow = {
  id?: string;
  contact_id: string;
  label: string;
  value: string;
  field_type: ContactFieldType;
  sort_order: number;
};

type ContactFieldRpcPayload = Omit<ContactFieldRow, "contact_id">;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const messageFromUnknown = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

export const normalizeContactsError = (_error: unknown, fallback: string) => fallback;

const throwContactsError = (error: unknown, fallback: string): never => {
  messageFromUnknown(error);
  throw new Error(normalizeContactsError(error, fallback));
};

// ── Link normalization ───────────────────────────────────────────────────────
// Coerce free-form input into a safe href. normalizeContactUrl is the generic
// fallback; normalizeContactValueForType applies platform-specific rules (extract
// the handle from a pasted Instagram/Telegram URL, build a wa.me/tel:/mailto: link).
export const normalizeContactUrl = (value: string) => {
  const trimmed = stripHtmlText(value);
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (isValidEmail(trimmed)) return `mailto:${trimmed}`;
  if (trimmed.startsWith("@")) return `https://t.me/${trimmed.slice(1)}`;
  if (/^\+?\d[\d\s-]+$/.test(trimmed)) return `tel:${trimmed.replace(/[^\d+]/g, "")}`;
  return `https://${trimmed}`;
};

export const normalizeContactValueForType = (value: string, fieldType: ContactFieldType) => {
  const trimmed = stripHtmlText(value);
  if (fieldType === "text") return trimmed;
  if (fieldType === "email") return /^mailto:/i.test(trimmed) ? trimmed : `mailto:${trimmed.replace(/^mailto:/i, "")}`;
  if (fieldType === "phone") return /^tel:/i.test(trimmed) ? trimmed : `tel:${trimmed.replace(/[^\d+]/g, "")}`;
  if (fieldType === "whatsapp") {
    return `https://wa.me/${trimmed.replace(/[^\d]/g, "")}`;
  }
  if (fieldType === "telegram") {
    const handle = trimmed
      .replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0];
    return `https://t.me/${handle}`;
  }
  if (fieldType === "instagram") {
    const handle = trimmed
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0];
    return `https://www.instagram.com/${handle.replace(/^\/+|\/+$/g, "")}`;
  }
  return normalizeContactUrl(trimmed);
};

export const isExternalContactUrl = (value: string) => {
  const normalized = normalizeContactUrl(value);
  return /^https?:/i.test(normalized);
};

// ── Payload builders ─────────────────────────────────────────────────────────
// buildContactFieldRows caps a card at 5 fields, drops empties, and only keeps an
// existing id when it's a real UUID (so new rows insert rather than collide).
export const buildContactPayload = ({ label, sortOrder }: Pick<SaveContactInput, "label" | "sortOrder">): ContactPayload => ({
  label: stripHtmlText(label),
  sort_order: sortOrder,
  active: true,
});

export const buildContactFieldRows = (contactId: string, fields: ContactFieldDraft[]): ContactFieldRow[] => (
  fields
    .slice(0, 5)
    .map((field, index) => {
      const label = stripHtmlText(field.label);
      const value = stripHtmlText(field.value);
      return {
        ...(field.id && uuidPattern.test(field.id) ? { id: field.id } : {}),
        contact_id: contactId,
        label,
        value: normalizeContactValueForType(value, field.field_type),
        field_type: field.field_type,
        sort_order: (index + 1) * 10,
      };
    })
    .filter((field) => field.label && field.value)
);

// ── Reads (public) ───────────────────────────────────────────────────────────
export const loadContacts = async ({ limit = 50 }: { limit?: number } = {}) => {
  const { data, error } = await supabase
    .from("site_contacts")
    .select("*, site_contact_fields(*)")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .order("sort_order", { referencedTable: "site_contact_fields", ascending: true })
    .limit(limit);

  if (error) throwContactsError(error, "Could not load contacts.");
  return (data ?? []) as ContactWithFields[];
};

// ── Admin writes (assume a verified session) ─────────────────────────────────
// Two steps: upsert the contact row to get its id, then replace its fields atomically
// via the upsert_contact_fields RPC.
export const saveContact = async (input: SaveContactInput) => {
  // Assumes caller has already verified an admin session.
  const contactPayload = buildContactPayload(input);
  const { data: savedContact, error: contactError } = input.editingId
    ? await supabase.from("site_contacts").update(contactPayload).eq("id", input.editingId).select("id").single()
    : await supabase.from("site_contacts").insert(contactPayload).select("id").single();

  if (contactError) throwContactsError(contactError, "Could not save contact.");
  const targetContactId = input.editingId ?? savedContact?.id;
  if (!targetContactId) throw new Error("Could not save contact.");

  const fieldRows = buildContactFieldRows(targetContactId, input.fields);
  const fieldPayload: ContactFieldRpcPayload[] = fieldRows.map(({ contact_id: _contactId, ...field }) => field);
  const { error: fieldError } = await supabase.rpc("upsert_contact_fields", {
    _contact_id: targetContactId,
    _fields: fieldPayload as unknown as Json,
  });
  if (fieldError) throwContactsError(fieldError, "Could not save contact.");
};

