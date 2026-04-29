import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, GripVertical, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Reveal } from "@/components/Reveal";
import { supabase } from "@/integrations/supabase/client";
import { EventItem } from "@/lib/events";
import type { Tables } from "@/integrations/supabase/types";
import { format, isPast } from "date-fns";
import { toast } from "sonner";
import bauhausBg from "@/assets/bauhaus-music-bg.jpg";
import { getErrorMessage } from "@/lib/errors";
import { useAdmin } from "@/hooks/useAdmin";

type SiteContact = Tables<"site_contacts">;
type SiteContactField = Tables<"site_contact_fields">;
type ContactFieldType = "text" | "link";
type ContactWithFields = SiteContact & { site_contact_fields?: SiteContactField[] };
type EditableField = {
  id?: string;
  label: string;
  value: string;
  field_type: ContactFieldType;
  sort_order: number;
};

const Landing = () => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [contacts, setContacts] = useState<ContactWithFields[]>([]);
  const { isAdmin, ensureAdminSession } = useAdmin();
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<SiteContact | null>(null);
  const [draggingContactId, setDraggingContactId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("events")
      .select("*")
      .order("event_date", { ascending: true })
      .then(({ data }) => {
        if (data) setEvents(data as EventItem[]);
      });
  }, []);

  const nextGig = useMemo(
    () => events.find((event) => !isPast(new Date(event.end_date ?? event.event_date))),
    [events],
  );

  const loadContacts = async () => {
    const { data, error } = await supabase
      .from("site_contacts")
      .select("*, site_contact_fields(*)")
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true })
      .order("sort_order", { referencedTable: "site_contact_fields", ascending: true });
    if (error) toast.error(error.message);
    else setContacts(data);
  };

  useEffect(() => {
    loadContacts();
    const ch = supabase
      .channel("site-contacts-public")
      .on("postgres_changes", { event: "*", schema: "public", table: "site_contacts" }, () => loadContacts())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const deleteContact = async (contact: SiteContact) => {
    if (!(await ensureAdminSession())) return;
    const { error } = await supabase.from("site_contacts").delete().eq("id", contact.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Contact removed");
      loadContacts();
    }
  };

  const reorderContacts = async (targetContactId: string) => {
    if (!isAdmin || !draggingContactId || draggingContactId === targetContactId) return;
    if (!(await ensureAdminSession())) return;

    const fromIndex = contacts.findIndex((contact) => contact.id === draggingContactId);
    const toIndex = contacts.findIndex((contact) => contact.id === targetContactId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextContacts = contacts.slice();
    const [moved] = nextContacts.splice(fromIndex, 1);
    nextContacts.splice(toIndex, 0, moved);
    setContacts(nextContacts);
    setDraggingContactId(null);

    const updates = nextContacts.map((contact, index) =>
      supabase
        .from("site_contacts")
        .update({ sort_order: (index + 1) * 10 })
        .eq("id", contact.id),
    );

    const results = await Promise.all(updates);
    const error = results.find((result) => result.error)?.error;
    if (error) {
      toast.error(error.message);
      loadContacts();
    }
  };

  return (
    <div className="app-page-bg min-h-screen text-foreground page-transition">
      <main>
      <section className="overflow-guard relative min-h-[calc(100svh-3.5rem)] overflow-hidden border-b">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.16] bg-cover bg-center mix-blend-multiply dark:mix-blend-screen"
            style={{ backgroundImage: `url(${bauhausBg})` }}
          />
          <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
            <div className="absolute left-[8%] top-[18%] h-[clamp(5rem,18vw,9rem)] w-[clamp(5rem,18vw,9rem)] rounded-full bg-primary/10 animate-float-slow" />
            <div className="absolute right-[8%] top-[18%] h-[clamp(7rem,24vw,13rem)] w-[clamp(7rem,24vw,13rem)] rounded-full border-[clamp(1rem,4vw,1.75rem)] border-[hsl(15_65%_55%/0.28)] animate-float-slower" />
            <div className="absolute bottom-[12%] left-[24%] h-0 w-0 border-l-[clamp(2.5rem,9vw,5.5rem)] border-r-[clamp(2.5rem,9vw,5.5rem)] border-b-[clamp(4rem,14vw,9rem)] border-l-transparent border-r-transparent border-b-[hsl(45_85%_55%/0.22)] animate-float-slow" />
            <div className="absolute bottom-[16%] right-[20%] h-[clamp(4rem,16vw,8rem)] w-[clamp(4rem,16vw,8rem)] rotate-12 bg-[hsl(190_60%_45%/0.20)]" />
          </div>

          <div className="relative z-10 mx-auto grid min-h-[calc(100svh-3.5rem)] w-full max-w-7xl items-center gap-8 px-4 py-[clamp(2rem,8vh,4rem)] sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
            <div className="hero-enter min-w-0">
              <h1 className="flex max-w-full items-start gap-[clamp(0.75rem,3vw,1.25rem)] text-wrap font-display text-[clamp(3.5rem,16vw,8rem)] leading-none text-primary">
                Eusoff Bandits
              </h1>
              <div className="relative mx-auto mt-[clamp(1.5rem,5vw,2.5rem)] h-[clamp(20rem,78vw,24rem)] w-full max-w-[min(36rem,94vw)] lg:mx-0">
                <Link
                  to="/bookings"
                  className="absolute left-[5%] top-0 z-30 grid h-[clamp(11rem,39vw,15rem)] w-[clamp(11rem,39vw,15rem)] -rotate-3 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-300 hover:-translate-y-1 hover:rotate-[-7deg] sm:left-[8%] lg:left-[4%]"
                >
                  <span className="max-w-[72%] text-center font-display text-[clamp(1.75rem,7vw,2.5rem)] leading-none">Book the Room</span>
                </Link>
                <Link
                  to="/backline"
                  className="absolute right-[10%] top-[12%] z-20 grid h-[clamp(8.25rem,28vw,9.75rem)] w-[clamp(8.25rem,28vw,9.75rem)] rotate-6 place-items-center rounded-full bg-card text-primary transition-transform duration-300 hover:-translate-y-1 hover:rotate-3 sm:right-[16%]"
                >
                  <span className="max-w-[72%] text-center font-display text-[clamp(1.15rem,4.5vw,1.5rem)] leading-none">Our Services</span>
                </Link>
                <Link
                  to="/events"
                  className="absolute left-[50%] top-[55%] z-10 grid h-[clamp(9rem,32vw,11.25rem)] w-[clamp(9rem,32vw,11.25rem)] -translate-x-1/2 rotate-2 place-items-center rounded-full bg-[hsl(15_65%_55%)] text-white transition-transform duration-300 hover:translate-y-1 hover:rotate-[5deg]"
                >
                  <span className="max-w-[72%] text-center font-display text-[clamp(1.5rem,5vw,1.875rem)] leading-none">Events</span>
                </Link>
              </div>
            </div>

            <Link
              to="/events"
              className="hero-enter hero-enter-delay group relative w-full max-w-[min(100%,31rem)] justify-self-center transition-transform duration-300 hover:-rotate-1 hover:scale-[1.01]"
              aria-label={nextGig ? `Upcoming Gig: ${nextGig.title}` : "No upcoming event"}
            >
                <div className="mx-auto -mb-px flex w-[32%] items-end justify-center gap-[24%]">
                  <div className="h-[clamp(2.5rem,10vw,3.5rem)] w-1 -rotate-12 bg-[#202020]" />
                  <div className="h-[clamp(2.5rem,10vw,3.5rem)] w-1 rotate-12 bg-[#202020]" />
                </div>
                <div className="relative rounded-[clamp(1.25rem,5vw,2rem)] bg-[#242424] p-[clamp(0.875rem,3vw,1.25rem)] text-[#f7f0dc]">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_clamp(3rem,12vw,4rem)] sm:gap-4">
                    <div className="relative aspect-[4/3] min-h-[clamp(12rem,46vw,14rem)] overflow-hidden rounded-2xl bg-[#d8d1b8] text-[#202020] ring-4 ring-[#111111]">
                      {nextGig?.poster_url ? (
                        <img
                          src={nextGig.poster_url}
                          alt={nextGig.title}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : nextGig ? (
                        <div className="absolute inset-0 bg-[hsl(190_60%_45%)]" />
                      ) : (
                        <div
                          className="absolute inset-0 opacity-80"
                          style={{
                            background:
                              "repeating-linear-gradient(0deg, #d8d1b8 0 2px, #8d8878 2px 4px), repeating-linear-gradient(90deg, transparent 0 4px, rgba(32,32,32,0.18) 4px 6px)",
                          }}
                        />
                      )}
                      <div className="absolute inset-x-3 bottom-3 rounded-xl bg-[#f7f0dc]/95 p-[clamp(0.75rem,3vw,1rem)] text-[#202020]">
                        <div className="text-[clamp(0.6rem,2.2vw,0.7rem)] uppercase tracking-[0.18em] text-[#5f594c]">Upcoming Gig</div>
                        {nextGig ? (
                          <>
                            <div className="mt-1 line-clamp-2 font-display text-[clamp(1.5rem,6vw,1.875rem)] leading-none text-[#202020]">{nextGig.title}</div>
                            <div className="mt-2 text-[clamp(0.7rem,2.4vw,0.8rem)] text-[#5f594c]">
                              {format(new Date(nextGig.event_date), "MMM d · HH:mm")}
                            </div>
                          </>
                        ) : (
                          <div className="mt-1 font-display text-[clamp(1.5rem,6vw,1.875rem)] leading-none text-[#202020]">No event</div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-row items-center justify-center gap-3 sm:flex-col">
                      <div className="h-[clamp(2rem,8vw,2.5rem)] w-[clamp(2rem,8vw,2.5rem)] rounded-full bg-[#d6b84f] ring-4 ring-[#111111]" />
                      <div className="h-[clamp(1.5rem,7vw,2rem)] w-[clamp(1.5rem,7vw,2rem)] rounded-full bg-[#f7f0dc] ring-4 ring-[#111111]" />
                      <div className="h-[clamp(3rem,12vw,4rem)] w-3 rounded-full bg-[#111111]" />
                    </div>
                  </div>
                  <div className="absolute -bottom-3 left-[18%] h-5 w-[18%] -rotate-6 bg-[#202020]" />
                  <div className="absolute -bottom-3 right-[18%] h-5 w-[18%] rotate-6 bg-[#202020]" />
                </div>
            </Link>
          </div>
        </section>

        <section className="border-t bg-[hsl(var(--primary)/0.08)] dark:bg-[hsl(var(--primary)/0.14)]">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
            <Reveal>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-display text-[clamp(2.25rem,9vw,3rem)] text-primary">Contact Us</h2>
                    <p className="mt-2 text-muted-foreground">Reach out for bookings, backline, rates, gig details, or a quick hello.</p>
                  </div>
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingContact(null);
                      setContactOpen(true);
                    }}
                    className="admin-reveal w-full sm:w-auto"
                  >
                    <Plus className="h-4 w-4" /> Add contact
                  </Button>
                )}
              </div>
              {contacts.length === 0 ? (
                <div className="mt-6 rounded-xl border bg-background/60 p-5 text-muted-foreground">
                  Contact details will be added soon.
                </div>
              ) : (
                <div className="mt-6 grid gap-4 text-base sm:grid-cols-2 lg:grid-cols-3">
                  {contacts.map((contact) => (
                    <ContactCard
                      key={contact.id}
                      contact={contact}
                      isAdmin={isAdmin}
                      isDragging={draggingContactId === contact.id}
                      onDragStart={() => setDraggingContactId(contact.id)}
                      onDragEnd={() => setDraggingContactId(null)}
                      onDrop={() => reorderContacts(contact.id)}
                      onEdit={() => {
                        setEditingContact(contact);
                        setContactOpen(true);
                      }}
                      onDelete={() => deleteContact(contact)}
                    />
                  ))}
                </div>
              )}
            </Reveal>
          </div>
        </section>
      </main>
      <ContactDialog
        open={contactOpen}
        editing={editingContact}
        ensureAdminSession={ensureAdminSession}
        nextSortOrder={(contacts.length + 1) * 10}
        onClose={() => setContactOpen(false)}
        onSaved={() => {
          setContactOpen(false);
          loadContacts();
        }}
      />
    </div>
  );
};

const ContactCard = ({
  contact,
  isAdmin,
  isDragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onEdit,
  onDelete,
}: {
  contact: ContactWithFields;
  isAdmin: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) => (
  <article
    draggable={isAdmin}
    onDragStart={(event) => {
      event.dataTransfer.effectAllowed = "move";
      onDragStart();
    }}
    onDragEnd={onDragEnd}
    onDragOver={(event) => {
      if (!isAdmin) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }}
    onDrop={(event) => {
      event.preventDefault();
      onDrop();
    }}
    className={`rounded-2xl border bg-card p-5 shadow-soft transition-all ${isAdmin ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "scale-[0.98] opacity-60" : ""}`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {isAdmin && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <h3 className="mt-2 break-words font-display text-2xl text-primary">{contact.label}</h3>
        </div>
      </div>
      {isAdmin && (
        <div className="admin-reveal flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Edit ${contact.label}`}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDelete} aria-label={`Delete ${contact.label}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
    <div className="mt-4 space-y-2">
      {(contact.site_contact_fields ?? []).map((field) => (
        <div key={field.id} className="rounded-xl border bg-background/60 px-3 py-2">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{field.label}</div>
          {field.field_type === "link" ? (
            <a
              href={normalizeContactUrl(field.value)}
              target={isExternalContactUrl(field.value) ? "_blank" : undefined}
              rel={isExternalContactUrl(field.value) ? "noopener noreferrer" : undefined}
              className="mt-1 inline-flex max-w-full items-center gap-2 break-all text-sm text-primary underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-2">{field.value}</span>
            </a>
          ) : (
            <div className="mt-1 line-clamp-3 break-words text-sm text-foreground/80">{field.value}</div>
          )}
        </div>
      ))}
    </div>
  </article>
);

const ContactDialog = ({
  open,
  editing,
  ensureAdminSession,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ContactWithFields | null;
  ensureAdminSession: () => Promise<boolean>;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<EditableField[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? "");
    setFields(
      editing?.site_contact_fields?.length
        ? editing.site_contact_fields
            .slice()
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((field, index) => ({
              id: field.id,
              label: field.label,
              value: field.value,
              field_type: field.field_type as ContactFieldType,
              sort_order: field.sort_order ?? (index + 1) * 10,
            }))
        : [{ label: "Contact", value: "", field_type: "text", sort_order: 10 }],
    );
  }, [open, editing]);

  const save = async () => {
    if (!(await ensureAdminSession())) return;
    if (!label.trim()) {
      toast.error("Label is required");
      return;
    }
    const cleanFields = fields
      .slice(0, 4)
      .map((field, index) => ({
        ...field,
        label: field.label.trim(),
        value: field.value.trim(),
        sort_order: (index + 1) * 10,
      }))
      .filter((field) => field.label && field.value);
    if (cleanFields.length === 0) {
      toast.error("Add at least one contact field");
      return;
    }

    setSaving(true);
    try {
      const contactPayload = { label: label.trim(), sort_order: editing?.sort_order ?? nextSortOrder, active: true };
      const contactId = editing?.id;

      const { data: savedContact, error: contactError } = editing
        ? await supabase.from("site_contacts").update(contactPayload).eq("id", editing.id).select("id").single()
        : await supabase.from("site_contacts").insert(contactPayload).select("id").single();
      if (contactError) throw contactError;

      const targetContactId = contactId ?? savedContact.id;
      const { error: deleteError } = await supabase.from("site_contact_fields").delete().eq("contact_id", targetContactId);
      if (deleteError) throw deleteError;

      const { error: fieldError } = await supabase.from("site_contact_fields").insert(
        cleanFields.map((field) => ({
          contact_id: targetContactId,
          label: field.label,
          value: field.field_type === "link" ? normalizeContactUrl(field.value) : field.value,
          field_type: field.field_type,
          sort_order: field.sort_order,
        })),
      );
      if (fieldError) throw fieldError;

      toast.success(editing ? "Contact updated" : "Contact added");
      onSaved();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[min(90svh,42rem)] w-[min(calc(100vw-1rem),calc(100%-2rem))] max-w-[min(30rem,calc(100vw-1rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="contact-label">Label</Label>
            <Input id="contact-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ryan" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Fields</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={fields.length >= 4}
                onClick={() => setFields((current) => [...current, { label: "", value: "", field_type: "text", sort_order: (current.length + 1) * 10 }])}
              >
                <Plus className="h-4 w-4" /> Add field
              </Button>
            </div>
            {fields.map((field, index) => (
              <div key={index} className="rounded-xl border bg-background/60 p-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                  <div className="space-y-1.5">
                    <Label htmlFor={`contact-field-label-${index}`}>Label</Label>
                    <Input
                      id={`contact-field-label-${index}`}
                      value={field.label}
                      onChange={(e) => updateField(index, { label: e.target.value }, setFields)}
                      placeholder="Email, Telegram, Website"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={field.field_type} onValueChange={(value: ContactFieldType) => updateField(index, { field_type: value }, setFields)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="link">Link</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`contact-field-value-${index}`}>Value</Label>
                  <Input
                    id={`contact-field-value-${index}`}
                    value={field.value}
                    onChange={(e) => updateField(index, { value: e.target.value }, setFields)}
                    placeholder={field.field_type === "link" ? "https://t.me/username" : "Display text"}
                  />
                </div>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))}
                  >
                    <Trash2 className="h-4 w-4" /> Remove field
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">Cancel</Button>
          <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const updateField = (
  index: number,
  patch: Partial<EditableField>,
  setFields: Dispatch<SetStateAction<EditableField[]>>,
) => {
  setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
};

const normalizeContactUrl = (value: string) => {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("@")) return `https://t.me/${trimmed.slice(1)}`;
  if (/^\+?\d[\d\s-]+$/.test(trimmed)) return `tel:${trimmed.replace(/[^\d+]/g, "")}`;
  return `https://${trimmed}`;
};

const isExternalContactUrl = (value: string) => {
  const normalized = normalizeContactUrl(value);
  return /^https?:/i.test(normalized);
};

export default Landing;
