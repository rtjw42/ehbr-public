import { describe, expect, it, vi, beforeEach } from "vitest";
import { supabaseMock, queryResult, resetSupabaseMock } from "@/test/supabase-mock";

vi.mock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));

import {
  buildContactFieldRows,
  buildContactPayload,
  isExternalContactUrl,
  normalizeContactValueForType,
  normalizeContactUrl,
  normalizeContactsError,
  loadContacts,
  saveContact,
} from "./contacts";

beforeEach(() => resetSupabaseMock());

describe("contact service helpers", () => {
  it("builds sanitized contact payloads", () => {
    expect(buildContactPayload({ label: "<strong>Ryan</strong>", sortOrder: 20 })).toEqual({
      label: "Ryan",
      sort_order: 20,
      active: true,
    });
  });

  it("builds sanitized field rows with normalized sort order", () => {
    const rows = buildContactFieldRows("contact-1", [
      { label: "<b>Email</b>", value: "hello@example.com", field_type: "text", sort_order: 90 },
      { label: "Telegram", value: "@bandroom", field_type: "link", sort_order: 10 },
      { label: "", value: "ignored", field_type: "text", sort_order: 20 },
    ]);

    expect(rows).toEqual([
      { contact_id: "contact-1", label: "Email", value: "hello@example.com", field_type: "text", sort_order: 10 },
      { contact_id: "contact-1", label: "Telegram", value: "https://t.me/bandroom", field_type: "link", sort_order: 20 },
    ]);
  });

  it("limits saved field rows to five entries", () => {
    const rows = buildContactFieldRows("contact-1", Array.from({ length: 6 }, (_, index) => ({
      label: `Field ${index + 1}`,
      value: `Value ${index + 1}`,
      field_type: "text" as const,
      sort_order: index,
    })));

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.sort_order)).toEqual([10, 20, 30, 40, 50]);
  });

  it("preserves real field ids and ignores draft ids", () => {
    const rows = buildContactFieldRows("contact-1", [
      { id: "2cc6fb56-82f6-48e5-a2a9-4dfe02c91b81", label: "Email", value: "hello@example.com", field_type: "email", sort_order: 10 },
      { id: "draft-instagram", label: "Instagram", value: "@bandroom", field_type: "instagram", sort_order: 20 },
    ]);

    expect(rows[0].id).toBe("2cc6fb56-82f6-48e5-a2a9-4dfe02c91b81");
    expect(rows[1].id).toBeUndefined();
  });

  it("normalizes contact URLs", () => {
    expect(normalizeContactUrl("@bandroom")).toBe("https://t.me/bandroom");
    expect(normalizeContactUrl("+65 8123-4567")).toBe("tel:+6581234567");
    expect(normalizeContactUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
    expect(normalizeContactUrl("example.com")).toBe("https://example.com");
  });

  it("normalizes named contact field values", () => {
    expect(normalizeContactValueForType("@eusoff_band", "instagram")).toBe("https://www.instagram.com/eusoff_band");
    expect(normalizeContactValueForType("@bandroom", "telegram")).toBe("https://t.me/bandroom");
    expect(normalizeContactValueForType("https://t.me/bandroom?start=abc", "telegram")).toBe("https://t.me/bandroom");
    expect(normalizeContactValueForType("hello@example.com", "email")).toBe("mailto:hello@example.com");
    expect(normalizeContactValueForType("+65 8123 4567", "phone")).toBe("tel:+6581234567");
    expect(normalizeContactValueForType("+65 8123 4567", "whatsapp")).toBe("https://wa.me/6581234567");
    expect(normalizeContactValueForType("https://example.com/8123", "whatsapp")).toBe("https://wa.me/8123");
    expect(normalizeContactValueForType("https://www.instagram.com/eusoff_band/reels", "instagram")).toBe("https://www.instagram.com/eusoff_band");
    expect(normalizeContactValueForType("just text", "text")).toBe("just text");
  });

  it("detects external contact URLs", () => {
    expect(isExternalContactUrl("https://example.com")).toBe(true);
    expect(isExternalContactUrl("mailto:test@example.com")).toBe(false);
    expect(isExternalContactUrl("+65 8123-4567")).toBe(false);
  });

  it("normalizes contact errors to safe messages", () => {
    expect(normalizeContactsError({ message: "raw database detail" }, "Could not save contact."))
      .toBe("Could not save contact.");
  });
});

describe("loadContacts", () => {
  it("returns contacts with embedded fields", async () => {
    const rows = [{ id: "c1", site_contact_fields: [] }];
    supabaseMock.from.mockReturnValue(queryResult({ data: rows, error: null }));
    expect(await loadContacts()).toEqual(rows);
    expect(supabaseMock.from).toHaveBeenCalledWith("site_contacts");
  });

  it("throws a normalized error on failure", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: { message: "db" } }));
    await expect(loadContacts()).rejects.toThrow("Could not load contacts.");
  });
});

describe("saveContact", () => {
  it("inserts a new contact then upserts its fields via RPC", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: { id: "c-new" }, error: null }));
    supabaseMock.rpc.mockReturnValue(queryResult({ data: null, error: null }));

    await saveContact({
      label: "Bookings",
      sortOrder: 10,
      fields: [{ label: "Telegram", value: "@band", field_type: "telegram", sort_order: 0 }],
    });

    expect(supabaseMock.from).toHaveBeenCalledWith("site_contacts");
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "upsert_contact_fields",
      expect.objectContaining({ _contact_id: "c-new" }),
    );
  });

  it("uses the editing id when updating an existing contact", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: { id: "c-existing" }, error: null }));
    supabaseMock.rpc.mockReturnValue(queryResult({ data: null, error: null }));

    await saveContact({ editingId: "c-existing", label: "X", sortOrder: 10, fields: [] });
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "upsert_contact_fields",
      expect.objectContaining({ _contact_id: "c-existing" }),
    );
  });

  it("throws a normalized error when the contact write fails", async () => {
    supabaseMock.from.mockReturnValue(queryResult({ data: null, error: { message: "boom" } }));
    await expect(saveContact({ label: "X", sortOrder: 10, fields: [] }))
      .rejects.toThrow("Could not save contact.");
  });
});
