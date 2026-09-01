import { ExternalLink, Instagram, Mail, MessageCircle, Phone, Send } from "lucide-react";
import type { ContactFieldType } from "@/services/contacts";

// Single source for the contact-link presentation shared by the site footer and
// anywhere that mirrors it (e.g. the landing About card), so the two never drift.
export const FOOTER_CONTACT_TYPES: ContactFieldType[] = ["instagram", "telegram", "email", "phone", "whatsapp"];
export const linkedContactTypes = new Set<ContactFieldType>(FOOTER_CONTACT_TYPES);

export const contactFieldIcon = (fieldType: string) => {
  if (fieldType === "instagram") return Instagram;
  if (fieldType === "telegram") return Send;
  if (fieldType === "email") return Mail;
  if (fieldType === "phone") return Phone;
  if (fieldType === "whatsapp") return MessageCircle;
  return ExternalLink;
};

export const contactFieldLabel = (fieldType: string, fallback: string) => {
  if (fieldType === "instagram") return "Instagram";
  if (fieldType === "telegram") return "Telegram";
  if (fieldType === "email") return "Email";
  if (fieldType === "phone") return "Phone";
  if (fieldType === "whatsapp") return "WhatsApp";
  return fallback || "Link";
};

export type ContactLinkField = {
  id?: string;
  field_type: string;
  value: string;
  label?: string;
};

const typeRank = (fieldType: string) => {
  const index = FOOTER_CONTACT_TYPES.indexOf(fieldType as ContactFieldType);
  return index === -1 ? FOOTER_CONTACT_TYPES.length : index;
};

// Stable sort by social type (footer order), keeping each type's internal order.
// Used by the admin form so fields stay grouped by social no matter the add order.
export const sortContactFieldsByType = <T extends { field_type: string }>(fields: T[]): T[] =>
  fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => typeRank(a.field.field_type) - typeRank(b.field.field_type) || a.index - b.index)
    .map(({ field }) => field);

// Group the linked contact fields by social type, in footer order. Drives the public
// icon row: a type with one field renders a direct link, two or more collapse into a
// single icon that opens a popover listing the links.
export const groupContactFieldsByType = <T extends ContactLinkField>(
  fields: T[],
): { type: ContactFieldType; fields: T[] }[] => {
  const groups = new Map<ContactFieldType, T[]>();
  for (const field of fields) {
    const type = field.field_type as ContactFieldType;
    if (!linkedContactTypes.has(type)) continue;
    groups.set(type, [...(groups.get(type) ?? []), field]);
  }
  return FOOTER_CONTACT_TYPES.filter((type) => groups.has(type)).map((type) => ({ type, fields: groups.get(type)! }));
};
