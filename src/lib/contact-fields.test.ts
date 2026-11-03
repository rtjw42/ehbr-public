import { describe, expect, it } from "vitest";
import { ExternalLink, Instagram, Mail, MessageCircle, Phone, Send } from "lucide-react";
import {
  FOOTER_CONTACT_TYPES,
  contactFieldIcon,
  contactFieldLabel,
  groupContactFieldsByType,
  sortContactFieldsByType,
} from "./contact-fields";

const field = (field_type: string, value: string) => ({ field_type, value });

describe("presentation", () => {
  it("maps each footer type to its icon, and anything else to a generic link", () => {
    expect(contactFieldIcon("instagram")).toBe(Instagram);
    expect(contactFieldIcon("telegram")).toBe(Send);
    expect(contactFieldIcon("email")).toBe(Mail);
    expect(contactFieldIcon("phone")).toBe(Phone);
    expect(contactFieldIcon("whatsapp")).toBe(MessageCircle);
    expect(contactFieldIcon("website")).toBe(ExternalLink);
  });

  it("labels known types by name and falls back for the rest", () => {
    expect(contactFieldLabel("whatsapp", "x")).toBe("WhatsApp");
    expect(contactFieldLabel("website", "Our site")).toBe("Our site");
    expect(contactFieldLabel("website", "")).toBe("Link");
  });
});

describe("sortContactFieldsByType", () => {
  it("orders by footer type and keeps each type's own order", () => {
    const fields = [field("email", "a"), field("other", "z"), field("instagram", "b"), field("email", "c")];
    expect(sortContactFieldsByType(fields).map((f) => f.value)).toEqual(["b", "a", "c", "z"]);
  });

  it("does not mutate its input", () => {
    const fields = [field("email", "a"), field("instagram", "b")];
    sortContactFieldsByType(fields);
    expect(fields.map((f) => f.value)).toEqual(["a", "b"]);
  });
});

describe("groupContactFieldsByType", () => {
  it("groups linked types in footer order and drops unlinked ones", () => {
    const groups = groupContactFieldsByType([
      field("phone", "1"),
      field("instagram", "ig"),
      field("website", "w"),
      field("phone", "2"),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["instagram", "phone"]);
    expect(groups[1].fields.map((f) => f.value)).toEqual(["1", "2"]);
  });

  it("returns nothing for no fields, and covers every footer type", () => {
    expect(groupContactFieldsByType([])).toEqual([]);
    const all = groupContactFieldsByType(FOOTER_CONTACT_TYPES.map((t) => field(t, t)));
    expect(all.map((g) => g.type)).toEqual(FOOTER_CONTACT_TYPES);
  });
});
