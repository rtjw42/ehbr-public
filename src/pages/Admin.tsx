import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Booking, bookingBg, bookingBorder, bookingDot, overlaps } from "@/lib/booking-utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { LogOut, Check, X, Trash2, Pencil, Copy, KeyRound, Ban, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { BookingForm } from "@/components/BookingForm";
import type { Tables } from "@/integrations/supabase/types";
import { getErrorMessage } from "@/lib/errors";
import { useAdmin } from "@/hooks/useAdmin";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MASTER_ADMIN_EMAIL = "rtjw42@gmail.com";

type AdminInvite = Tables<"admin_invite_codes">;
type ApprovedSingle = { kind: "single"; booking: Booking };
type ApprovedSeries = {
  kind: "series";
  groupId: string;
  name: string;
  contact: string;
  occurrences: Booking[];
  recurrenceLabel: string;
  dateRangeLabel: string;
  representative: Booking;
};
type ApprovedRow = ApprovedSingle | ApprovedSeries;

const Admin = () => {
  const { authChecked, isAdminPanelOpen, isAdminPanelClosing, userEmail, closeAdminPanel, signOutAdmin, ensureAdminSession } = useAdmin();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [inviteLabel, setInviteLabel] = useState("Band leader");
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [generatedInvite, setGeneratedInvite] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Booking | null>(null);
  const [pendingSeriesDelete, setPendingSeriesDelete] = useState<ApprovedSeries | null>(null);
  const [pendingRejectDelete, setPendingRejectDelete] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [bookingFormOpen, setBookingFormOpen] = useState(false);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(() => new Set());

  const isMasterAdmin = userEmail.toLowerCase() === MASTER_ADMIN_EMAIL;

  const closeAdmin = useCallback(() => {
    closeAdminPanel();
  }, [closeAdminPanel]);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .order("start_time", { ascending: true });
    if (!error && data) setBookings(data as Booking[]);
  }, []);

  const loadInvites = useCallback(async () => {
    const { data, error } = await supabase
      .from("admin_invite_codes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setInvites(data);
  }, []);

  useEffect(() => { if (isAdminPanelOpen) load(); }, [isAdminPanelOpen, load]);
  useEffect(() => { if (isAdminPanelOpen && isMasterAdmin) loadInvites(); }, [isAdminPanelOpen, isMasterAdmin, loadInvites]);
  useEffect(() => {
    if (isAdminPanelOpen) return;
    setGeneratedInvite("");
    setInviteBusy(false);
  }, [isAdminPanelOpen]);

  useEffect(() => {
    if (!isAdminPanelOpen) return;
    const ch = supabase
      .channel("bookings-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => load())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    return () => { supabase.removeChannel(ch); };
  }, [isAdminPanelOpen, load]);

  const approved = useMemo(() => bookings.filter((b) => b.status === "approved"), [bookings]);
  const approvedRows = useMemo(() => getApprovedRows(approved), [approved]);
  const pending = useMemo(() => bookings.filter((b) => b.status === "pending"), [bookings]);

  const conflictsFor = (b: Booking) =>
    approved.filter((a) => a.id !== b.id && overlaps(new Date(b.start_time), new Date(b.end_time), new Date(a.start_time), new Date(a.end_time)));

  const approve = async (b: Booking) => {
    if (!(await ensureAdminSession())) return;
    setBookings((prev) => prev.map((x) => x.id === b.id ? { ...x, status: "approved" } : x));
    const { error } = await supabase.rpc("approve_booking", { _booking_id: b.id });
    if (error) { toast.error(error.message); load(); } else toast.success("Approved");
  };

  const reject = (b: Booking) => {
    setPendingRejectDelete(b);
  };

  const confirmRejectDelete = async () => {
    if (!pendingRejectDelete) return;
    if (!(await ensureAdminSession())) return;
    const target = pendingRejectDelete;
    setPendingRejectDelete(null);
    setBookings((prev) => prev.filter((x) => x.id !== target.id));
    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("id", target.id)
      .eq("status", "pending");
    if (error) {
      toast.error(error.message);
      load();
      return;
    }
    toast.success("Request deleted");
  };

  const approveGroupAll = async (items: Booking[]) => {
    if (!(await ensureAdminSession())) return;
    // Approve every instance, overwriting any conflicting approved bookings
    const conflictIds = Array.from(new Set(items.flatMap((it) => conflictsFor(it).map((c) => c.id))));
    const itemIds = new Set(items.map((it) => it.id));
    const conflictIdSet = new Set(conflictIds);
    setBookings((prev) => prev.map((x) => {
      if (itemIds.has(x.id)) return { ...x, status: "approved" };
      if (conflictIdSet.has(x.id)) return { ...x, status: "rejected" };
      return x;
    }));
    const groupId = items[0]?.group_id;
    const { data, error } = groupId
      ? await supabase.rpc("approve_booking_group_overwrite", { _group_id: groupId })
      : await supabase.rpc("approve_booking", { _booking_id: items[0]?.id });
    if (error) { toast.error(error.message); load(); }
    else toast.success(`Approved ${data ?? items.length} session${items.length === 1 ? "" : "s"}${conflictIds.length ? " (overwrote conflicts)" : ""}`);
  };

  const overwriteApprove = async (b: Booking, conflicts: Booking[]) => {
    if (!(await ensureAdminSession())) return;
    const conflictIds = conflicts.map((c) => c.id);
    const conflictIdSet = new Set(conflictIds);
    setBookings((prev) => prev.map((x) => {
      if (x.id === b.id) return { ...x, status: "approved" };
      if (conflictIdSet.has(x.id)) return { ...x, status: "rejected" };
      return x;
    }));
    const { error } = await supabase.rpc("approve_booking_overwrite", { _booking_id: b.id });
    if (error) { toast.error(error.message); load(); } else toast.success("Approved (overwrote conflicts)");
  };

  const remove = async (b: Booking) => {
    if (!(await ensureAdminSession())) return;
    setPendingDelete(null);
    setBookings((prev) => prev.filter((x) => x.id !== b.id));
    const { error } = await supabase.from("bookings").delete().eq("id", b.id);
    if (error) { toast.error(error.message); load(); } else toast.success("Deleted");
  };

  const removeFromOccurrence = async (b: Booking) => {
    if (!b.group_id) {
      await remove(b);
      return;
    }
    if (!(await ensureAdminSession())) return;
    setPendingDelete(null);
    setBookings((prev) => prev.filter((x) => x.group_id !== b.group_id || x.start_time < b.start_time));
    const { error } = await supabase
      .from("bookings")
      .delete()
      .eq("group_id", b.group_id)
      .gte("start_time", b.start_time);
    if (error) { toast.error(error.message); load(); } else toast.success("This and following occurrences deleted");
  };

  const removeGroup = async (group_id: string) => {
    if (!(await ensureAdminSession())) return;
    setPendingDelete(null);
    setPendingSeriesDelete(null);
    setBookings((prev) => prev.filter((x) => x.group_id !== group_id));
    const { error } = await supabase.from("bookings").delete().eq("group_id", group_id);
    if (error) { toast.error(error.message); load(); } else toast.success("Series deleted");
  };

  const toggleSeries = (groupId: string) => {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const createInvite = async () => {
    if (!(await ensureAdminSession())) return;
    setInviteBusy(true);
    try {
      const code = generateInviteCode();
      const codeHash = await sha256Hex(code);
      const expiresAt = inviteExpiresAt ? new Date(inviteExpiresAt).toISOString() : null;
      const { error } = await supabase.from("admin_invite_codes").insert({
        code_hash: codeHash,
        label: inviteLabel.trim() || "Band leader",
        max_uses: inviteMaxUses,
        expires_at: expiresAt,
      });
      if (error) throw error;
      setGeneratedInvite(code);
      toast.success("Invite code generated");
      loadInvites();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not generate invite"));
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!generatedInvite) return;
    try {
      await navigator.clipboard.writeText(generatedInvite);
      toast.success("Invite copied");
    } catch {
      toast.error("Could not copy invite");
    }
  };

  const deactivateInvite = async (invite: AdminInvite) => {
    if (!(await ensureAdminSession())) return;
    const { error } = await supabase
      .from("admin_invite_codes")
      .update({ active: false })
      .eq("id", invite.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Invite deactivated");
      loadInvites();
    }
  };

  const signOut = async () => { await signOutAdmin(); };

  if (!isAdminPanelOpen) return null;

  if (!authChecked) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[45]">
        <div className="pointer-events-auto fixed inset-x-3 top-[calc(var(--site-nav-height)+0.5rem)] z-10 mx-auto flex min-h-28 max-w-[min(32rem,calc(100vw-1.5rem))] items-center justify-center rounded-[clamp(1.25rem,4vw,2rem)] border bg-background shadow-elev sm:inset-x-auto sm:right-4 sm:top-[calc(var(--site-nav-height)+0.75rem)] sm:mx-0 sm:w-[min(32rem,calc(100vw-2rem))]">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  // Group pending by group_id
  const pendingGroups: Record<string, Booking[]> = {};
  const pendingSingles: Booking[] = [];
  for (const p of pending) {
    if (p.group_id) (pendingGroups[p.group_id] ||= []).push(p);
    else pendingSingles.push(p);
  }

  const panel = (
    <div className={`flex max-h-[min(calc(100svh-var(--site-nav-height)-1rem),46rem)] w-full flex-col overflow-hidden rounded-[clamp(1.25rem,4vw,2rem)] border bg-background shadow-elev ${isAdminPanelClosing ? "admin-panel-closing" : ""}`}>
      <header className="shrink-0 border-b bg-card/40 backdrop-blur">
        <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3 hero-enter">
            <Button variant="ghost" size="sm" onClick={closeAdmin}><X className="h-4 w-4" /> Close</Button>
            <h1 className="font-display text-[clamp(1.5rem,7vw,2rem)] text-primary">Admin</h1>
          </div>
          <Button size="sm" onClick={() => { setEditing(null); setBookingFormOpen(true); }} className="admin-reveal">
            <Plus className="h-4 w-4" /> Add Booking
          </Button>
        </div>
      </header>

      <main className="w-full flex-1 overflow-y-auto px-4 py-5 sm:px-5" data-lenis-prevent>
        <Tabs defaultValue="pending">
          <TabsList className="h-auto max-w-full flex-wrap justify-start overflow-x-auto">
            <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
            <TabsTrigger value="approved">Approved ({approved.length})</TabsTrigger>
            {isMasterAdmin && <TabsTrigger value="invites">Invites</TabsTrigger>}
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {pending.length === 0 && <p className="text-muted-foreground italic py-8 text-center">No pending requests.</p>}

            {Object.entries(pendingGroups).map(([gid, items]) => {
              const first = items[0];
              const allConflicts = items.flatMap(conflictsFor);
              return (
                <div key={gid} className="rounded-2xl border bg-card p-4 space-y-3 shadow-soft">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-semibold">{first.name} <span className="text-muted-foreground text-xs">· recurring series ({items.length})</span></div>
                      <div className="text-xs text-muted-foreground">@{first.contact.replace(/^@/, "")}</div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                      <Button size="sm" onClick={() => approveGroupAll(items)} className="admin-reveal w-full sm:w-auto">
                        <Check className="h-4 w-4" /> Approve all
                      </Button>
                      <Button size="sm" variant="outline" className="admin-reveal w-full sm:w-auto [animation-delay:70ms]" onClick={async () => {
                        for (const it of items) {
                          if (conflictsFor(it).length === 0) await approve(it);
                        }
                      }}>
                        <Check className="h-4 w-4" /> Approve non-conflicting
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => removeGroup(gid)} className="admin-reveal w-full sm:w-auto [animation-delay:140ms]">
                        <Trash2 className="h-4 w-4" /> Delete series
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {items.map((b) => <PendingItem key={b.id} b={b} conflicts={conflictsFor(b)} onApprove={approve} onReject={reject} onOverwrite={overwriteApprove} />)}
                  </div>
                  {allConflicts.length > 0 && (
                    <div className="text-xs text-destructive">⚠ Some instances conflict with approved bookings.</div>
                  )}
                </div>
              );
            })}

            {pendingSingles.map((b) => (
              <PendingItem key={b.id} b={b} conflicts={conflictsFor(b)} onApprove={approve} onReject={reject} onOverwrite={overwriteApprove} card />
            ))}
          </TabsContent>

          <TabsContent value="approved" className="space-y-2">
            {approved.length === 0 && <p className="text-muted-foreground italic py-8 text-center">No approved bookings.</p>}
            {approvedRows.map((row) => row.kind === "single" ? (
              <BookingRow key={row.booking.id} b={row.booking} onEdit={() => setEditing(row.booking)} onDelete={() => setPendingDelete(row.booking)} />
            ) : (
              <ApprovedSeriesRow
                key={row.groupId}
                series={row}
                expanded={expandedSeries.has(row.groupId)}
                onToggle={() => toggleSeries(row.groupId)}
                onDeleteSeries={() => setPendingSeriesDelete(row)}
                onEdit={(booking) => setEditing(booking)}
                onDeleteOccurrence={(booking) => setPendingDelete(booking)}
              />
            ))}
          </TabsContent>

          {isMasterAdmin && (
            <TabsContent value="invites" className="space-y-4">
              <div className="rounded-2xl border bg-card p-4 shadow-soft space-y-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <h2 className="font-semibold">Generate band leader invite</h2>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)_minmax(10rem,12rem)]">
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-label">Label</Label>
                    <Input id="invite-label" value={inviteLabel} onChange={(e) => setInviteLabel(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-max">Max uses</Label>
                    <Input
                      id="invite-max"
                      type="number"
                      min={1}
                      max={20}
                      value={inviteMaxUses}
                      onChange={(e) => setInviteMaxUses(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-expiry">Expires</Label>
                    <Input
                      id="invite-expiry"
                      type="datetime-local"
                      value={inviteExpiresAt}
                      onChange={(e) => setInviteExpiresAt(e.target.value)}
                    />
                  </div>
                </div>
                <Button onClick={createInvite} disabled={inviteBusy} className="admin-reveal w-full sm:w-auto">
                  <KeyRound className="h-4 w-4" /> {inviteBusy ? "Generating..." : "Generate invite"}
                </Button>

                {generatedInvite && (
                  <div className="flex flex-col gap-3 rounded-xl border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">Shown once</div>
                      <div className="break-all font-mono text-base tracking-wide sm:text-lg">{generatedInvite}</div>
                    </div>
                    <Button variant="outline" onClick={copyInvite} className="admin-reveal w-full sm:w-auto">
                      <Copy className="h-4 w-4" /> Copy
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {invites.length === 0 && <p className="text-muted-foreground italic py-8 text-center">No invite codes yet.</p>}
                {invites.map((invite) => (
                  <InviteRow key={invite.id} invite={invite} onDeactivate={() => deactivateInvite(invite)} />
                ))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      </main>

      <footer className="shrink-0 border-t bg-card/40 px-4 py-3 sm:px-5">
        <div className="flex w-full justify-end">
          <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</Button>
        </div>
      </footer>

      <BookingForm
        open={bookingFormOpen || !!editing}
        onClose={() => {
          setBookingFormOpen(false);
          setEditing(null);
        }}
        approvedBookings={approved}
        editing={editing}
        adminMode
        ensureAdminSession={ensureAdminSession}
        onSubmitted={load}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.group_id
                ? "Choose whether to delete only this occurrence, or this occurrence and every later one in the series."
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {pendingDelete?.group_id && (
              <Button variant="outline" onClick={() => pendingDelete && removeFromOccurrence(pendingDelete)} className="w-full sm:w-auto">
                Delete this and following
              </Button>
            )}
            <AlertDialogAction onClick={() => pendingDelete && remove(pendingDelete)}>
              {pendingDelete?.group_id ? "Delete this occurrence" : "Delete booking"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingSeriesDelete} onOpenChange={(open) => !open && setPendingSeriesDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recurring series?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes all {pendingSeriesDelete?.occurrences.length ?? 0} approved bookings in the series for {pendingSeriesDelete?.name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingSeriesDelete && removeGroup(pendingSeriesDelete.groupId)}>
              Delete series
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingRejectDelete} onOpenChange={(open) => !open && setPendingRejectDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pending request?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the pending booking request from {pendingRejectDelete?.name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRejectDelete}>Delete request</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-[45]">
      <button type="button" className={`pointer-events-auto fixed inset-x-0 bottom-0 top-[var(--site-nav-height)] cursor-default transition-opacity duration-200 ${isAdminPanelClosing ? "opacity-0" : "opacity-100"}`} aria-label="Close admin panel" onClick={closeAdmin} />
      <div className={`pointer-events-auto fixed inset-x-3 top-[calc(var(--site-nav-height)+0.5rem)] z-10 mx-auto max-w-[min(42rem,calc(100vw-1.5rem))] ${isAdminPanelClosing ? "admin-panel-closing animate-admin-dropdown-out" : "animate-admin-dropdown"} sm:inset-x-auto sm:right-4 sm:top-[calc(var(--site-nav-height)+0.75rem)] sm:mx-0 sm:w-[min(42rem,calc(100vw-2rem))]`}>
        {panel}
      </div>
    </div>
  );
};

const PendingItem = ({ b, conflicts, onApprove, onReject, onOverwrite, card }: {
  b: Booking; conflicts: Booking[];
  onApprove: (b: Booking) => void; onReject: (b: Booking) => void;
  onOverwrite: (b: Booking, c: Booking[]) => void; card?: boolean;
}) => {
  const wrapper = card ? "rounded-2xl border bg-card p-4 shadow-soft" : "rounded-xl border p-3 bg-background";
  return (
    <div className={wrapper}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bookingDot(b) }} />
            <div className="font-semibold truncate">{b.name}</div>
          </div>
          <div className="text-xs text-muted-foreground">@{b.contact.replace(/^@/, "")}</div>
          <div className="text-sm tabular-nums mt-1">
            {format(new Date(b.start_time), "EEE, MMM d HH:mm")} → {format(new Date(b.end_time), "HH:mm")}
          </div>
          {conflicts.length > 0 && (
            <div className="text-xs text-destructive mt-1">
              Conflicts: {conflicts.map((c) => c.name).join(", ")}
            </div>
          )}
        </div>
        <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:flex-wrap">
          {conflicts.length === 0 ? (
            <Button size="sm" onClick={() => onApprove(b)} className="admin-reveal w-full sm:w-auto"><Check className="h-4 w-4" /> Approve</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => onOverwrite(b, conflicts)} className="admin-reveal w-full sm:w-auto">
              Overwrite
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onReject(b)} className="admin-reveal w-full sm:w-auto [animation-delay:70ms]"><X className="h-4 w-4" /> Reject</Button>
        </div>
      </div>
    </div>
  );
};

const BookingRow = ({ b, onEdit, onDelete, showStatus }: { b: Booking; onEdit: () => void; onDelete: () => void; showStatus?: boolean }) => (
  <div
    className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
    style={{ backgroundColor: bookingBg(b), borderColor: bookingBorder(b) }}
  >
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bookingDot(b) }} />
        <div className="truncate font-semibold">{b.name}</div>
        {showStatus && (
          <span className="rounded border bg-background/60 px-1.5 py-0.5 text-[clamp(0.625rem,2vw,0.7rem)] uppercase tracking-wider">
            {b.status}
          </span>
        )}
      </div>
      <div className="break-words text-xs text-foreground/70 tabular-nums">
        {format(new Date(b.start_time), "EEE, MMM d HH:mm")} → {format(new Date(b.end_time), "HH:mm")} · @{b.contact.replace(/^@/, "")}
      </div>
    </div>
    <div className="flex w-full gap-1 sm:w-auto sm:justify-end">
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit" className="admin-reveal"><Pencil className="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete" className="admin-reveal [animation-delay:70ms]"><Trash2 className="h-4 w-4" /></Button>
    </div>
  </div>
);

const ApprovedSeriesRow = ({
  series,
  expanded,
  onToggle,
  onDeleteSeries,
  onEdit,
  onDeleteOccurrence,
}: {
  series: ApprovedSeries;
  expanded: boolean;
  onToggle: () => void;
  onDeleteSeries: () => void;
  onEdit: (booking: Booking) => void;
  onDeleteOccurrence: (booking: Booking) => void;
}) => (
  <div className="rounded-xl border bg-card/80 p-3 shadow-soft">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left transition-colors hover:bg-background/60 sm:items-center"
        aria-expanded={expanded}
      >
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-background sm:mt-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bookingDot(series.representative) }} />
            <span className="break-words font-semibold">{series.name}</span>
            <span className="rounded border bg-background/60 px-1.5 py-0.5 text-[clamp(0.625rem,2vw,0.7rem)] uppercase tracking-wider">
              Series
            </span>
          </span>
          <span className="mt-1 block break-words text-xs text-foreground/70">
            {series.recurrenceLabel} · {series.dateRangeLabel} · @{series.contact.replace(/^@/, "")}
          </span>
        </span>
      </button>
      <Button size="sm" variant="ghost" onClick={onDeleteSeries} className="admin-reveal w-full sm:w-auto" aria-label="Delete recurring series">
        <Trash2 className="h-4 w-4" /> Delete series
      </Button>
    </div>
    {expanded && (
      <div className="mt-3 space-y-2 border-t pt-3">
        {series.occurrences.map((booking) => (
          <BookingRow
            key={booking.id}
            b={booking}
            onEdit={() => onEdit(booking)}
            onDelete={() => onDeleteOccurrence(booking)}
          />
        ))}
      </div>
    )}
  </div>
);

const getApprovedRows = (approved: Booking[]): ApprovedRow[] => {
  const groups = new Map<string, Booking[]>();
  const singles: Booking[] = [];

  for (const booking of approved) {
    if (!booking.group_id) {
      singles.push(booking);
      continue;
    }
    groups.set(booking.group_id, [...(groups.get(booking.group_id) ?? []), booking]);
  }

  const rows: ApprovedRow[] = singles.map((booking) => ({ kind: "single", booking }));

  for (const [groupId, rawOccurrences] of groups) {
    const occurrences = [...rawOccurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    if (occurrences.length < 2) {
      rows.push({ kind: "single", booking: occurrences[0] });
      continue;
    }
    const first = occurrences[0];
    const last = occurrences[occurrences.length - 1];
    rows.push({
      kind: "series",
      groupId,
      name: first.name,
      contact: first.contact,
      occurrences,
      recurrenceLabel: `${inferRecurrencePattern(occurrences)}, ${occurrences.length} occurrence${occurrences.length === 1 ? "" : "s"}`,
      dateRangeLabel: `${format(new Date(first.start_time), "MMM d, yyyy")} – ${format(new Date(last.start_time), "MMM d, yyyy")}`,
      representative: first,
    });
  }

  return rows.sort((a, b) => {
    const aTime = new Date(a.kind === "single" ? a.booking.start_time : a.representative.start_time).getTime();
    const bTime = new Date(b.kind === "single" ? b.booking.start_time : b.representative.start_time).getTime();
    return aTime - bTime;
  });
};

const inferRecurrencePattern = (occurrences: Booking[]) => {
  if (occurrences.length < 2) return "Recurring";
  const first = new Date(occurrences[0].start_time);
  const second = new Date(occurrences[1].start_time);
  const diffDays = Math.round((second.getTime() - first.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 1) return "Daily";
  if (diffDays === 7) return "Weekly";
  if (diffDays >= 28 && diffDays <= 31) return "Monthly";
  return "Recurring";
};

const InviteRow = ({ invite, onDeactivate }: { invite: AdminInvite; onDeactivate: () => void }) => {
  const isExpired = invite.expires_at ? new Date(invite.expires_at) <= new Date() : false;
  const isUsedUp = invite.used_count >= invite.max_uses;
  const status = !invite.active ? "Inactive" : isExpired ? "Expired" : isUsedUp ? "Used" : "Active";

  return (
    <div className="rounded-xl border bg-card p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{invite.label || "Band leader"}</span>
          <span className="rounded border bg-background/60 px-1.5 py-0.5 text-[clamp(0.625rem,2vw,0.7rem)] uppercase tracking-wider">
            {status}
          </span>
        </div>
        <div className="mt-1 break-words text-xs text-muted-foreground">
          Used {invite.used_count}/{invite.max_uses}
          {invite.expires_at ? ` · expires ${format(new Date(invite.expires_at), "MMM d, yyyy HH:mm")}` : " · no expiry"}
          {invite.last_used_at ? ` · last used ${format(new Date(invite.last_used_at), "MMM d, yyyy HH:mm")}` : ""}
        </div>
      </div>
      {invite.active && (
      <Button size="sm" variant="outline" onClick={onDeactivate} className="admin-reveal w-full sm:w-auto">
          <Ban className="h-4 w-4" /> Deactivate
        </Button>
      )}
    </div>
  );
};

const generateInviteCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]);
  return `EB-2026-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
};

const sha256Hex = async (value: string) => {
  const bytes = new TextEncoder().encode(value.trim());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export default Admin;
