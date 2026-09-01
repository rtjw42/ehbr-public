// ── Admin overlay (/admin) ───────────────────────────────────────────────────
// The management surface: pending approvals, all bookings, plus events/backline/
// contacts editing. Every mutating action awaits ensureAdminSession() to re-verify
// the LIVE admin session before touching anything; the UI is optimistic with rollback
// on failure, and a realtime subscription keeps the lists current across devices.
import { Suspense, useEffect, useState, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Booking,
  bookingBg,
  bookingBorder,
  bookingDot,
  dispatchBookingApprovedChanged,
  fmtBookingSpan,
  fmtDate,
  fmtDateTime,
  isMultiDay,
  overlaps,
} from "@/lib/booking-utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  KeyRound,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LazyBookingForm } from "@/components/LazyBookingForm";
import type { BookingFormSubmitResult } from "@/components/BookingForm";
import { preloadBookingForm } from "@/lib/booking-form-loader";
import { useAdmin } from "@/hooks/useAdmin";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { Navigate } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { PageHeaderBar } from "@/components/PageHeaderBar";
import { AdminWeekView } from "@/components/AdminWeekView";
import { DayDetailDialog } from "@/components/DayDetailDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ADMIN_DISPLAY_NAME_MAX,
  INVITE_EXPIRY_DAYS,
  createAdminInvite,
  deactivateAdminInvite,
  setStaffActive,
  loadAdminInvites,
  loadMyAdminDisplayName,
  loadStaff,
  setBandHead,
  updateMyAdminDisplayName,
  type AdminInvite,
  type StaffMember,
} from "@/services/auth";
import {
  approveBooking,
  approveBookingGroup,
  deleteBooking,
  deleteBookingAndFollowingOccurrences,
  deleteBookingSeries,
  deletePendingBooking,
  loadAdminBookings,
} from "@/services/bookings";
import { useI18n } from "@/hooks/useI18n";
import type { TranslationKey } from "@/lib/i18n";
import { formatClockRange, formatLocalizedDate } from "@/lib/date";

type ApprovedSingle = { kind: "single"; booking: Booking };
type ApprovedSeries = {
  kind: "series";
  groupId: string;
  title: string;
  name: string;
  occurrences: Booking[];
  dateRangeLabel: string;
  representative: Booking;
};
type ApprovedRow = ApprovedSingle | ApprovedSeries;
type ApprovedView = "current" | "past";
type AdminActionKeys = {
  approve: string;
  reject: string;
  delete: string;
  deleteFollowing: string;
};
// One shape for every whole-group delete confirmation (pending OR approved,
// pattern OR custom) so both tabs share a single dialog with kind-aware copy.
type GroupDeleteTarget = {
  groupId: string;
  name: string;
  count: number;
  kind: "pattern" | "custom";
};
// A pending instance paired with the approved bookings blocking it. First-come
// wins: any clash means the whole request's Approve is blocked (never overwrite).
type PendingClash = { instance: Booking; holders: Booking[] };

const statusKeyFor = (status: Booking["status"]): TranslationKey => {
  if (status === "approved") return "bookingStatus.approved";
  if (status === "rejected") return "bookingStatus.rejected";
  return "bookingStatus.pending";
};

// Compact header button: icon always, label only on sm+ (so the header row fits on
// one line on mobile without wrapping). aria-label + title keep the icon-only state
// accessible. Used for every tab-header action so both states share one height.
const HeaderAction = ({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  variant = "default",
  alwaysLabel = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
  // Keep the text label at every size (unambiguous primary actions like Approve);
  // the rest collapse to icon-only on mobile so the header fits one line.
  alwaysLabel?: boolean;
}) => (
  <Button
    size="sm"
    variant={variant}
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="shrink-0 rounded-full"
  >
    <Icon className="h-4 w-4" />
    <span className={alwaysLabel ? "inline" : "hidden sm:inline"}>{label}</span>
  </Button>
);

const Admin = () => {
  const { authChecked, isAdmin, isHead, isOwner, userEmail, ensureAdminSession } = useAdmin();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [inviteLabel, setInviteLabel] = useState("Band leader");
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [generatedInvite, setGeneratedInvite] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffBusyId, setStaffBusyId] = useState<string | null>(null);
  const [pendingStaffDeactivate, setPendingStaffDeactivate] = useState<StaffMember | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Booking | null>(null);
  const [pendingGroupDelete, setPendingGroupDelete] = useState<GroupDeleteTarget | null>(null);
  const [pendingRejectDelete, setPendingRejectDelete] = useState<Booking | null>(null);
  const [editing, setEditing] = useState<Booking | null>(null);
  const [bookingFormOpen, setBookingFormOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(() => new Set());
  const [approvedView, setApprovedView] = useState<ApprovedView>("current");
  const [activeTab, setActiveTab] = useState("pending");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [busyActions, setBusyActions] = useState<Set<string>>(() => new Set());
  const busyActionsRef = useRef<Set<string>>(new Set());
  const { language, t } = useI18n();
  const canManageInvites = isHead || isOwner;
  const adminActive = authChecked && isAdmin;

  const load = useCallback(async () => {
    try {
      setBookings(await loadAdminBookings());
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : t("admin.loadBookingsFailed"));
    }
  }, [t]);

  const loadInvites = useCallback(async () => {
    try {
      setInvites(await loadAdminInvites());
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : t("admin.loadInvitesFailed"));
    }
  }, [t]);

  const loadStaffList = useCallback(async () => {
    try {
      setStaff(await loadStaff());
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : t("admin.org.loadFailed"));
    }
  }, [t]);

  const loadDisplayName = useCallback(async () => {
    try {
      const name = await loadMyAdminDisplayName();
      setDisplayName(name);
      setSavedName(name);
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : t("admin.profile.loadFailed"));
    }
  }, [t]);

  // Dirty check: nothing to save until the name actually changes from what's stored.
  const nameDirty = displayName.trim() !== savedName.trim();

  const saveDisplayName = async () => {
    if (savingName || !displayName.trim() || !nameDirty) return;
    if (!(await ensureAdminSession())) return;
    setSavingName(true);
    try {
      const saved = await updateMyAdminDisplayName(displayName);
      setDisplayName(saved);
      setSavedName(saved);
      toast.success(t("admin.profile.saved"));
      await load();
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, t("admin.profile.saveFailed")));
    } finally {
      setSavingName(false);
    }
  };

  useEffect(() => { if (adminActive) load(); }, [adminActive, load]);
  useEffect(() => { if (adminActive) loadDisplayName(); }, [adminActive, loadDisplayName]);
  useEffect(() => { if (adminActive && canManageInvites) loadInvites(); }, [adminActive, canManageInvites, loadInvites]);
  useEffect(() => { if (adminActive && isOwner) loadStaffList(); }, [adminActive, isOwner, loadStaffList]);
  useEffect(() => {
    if (adminActive) return;
    setGeneratedInvite("");
    setInviteBusy(false);
  }, [adminActive]);

  useEffect(() => {
    if (!adminActive) return;
    const ch = supabase
      .channel("bookings-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => load())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    return () => { supabase.removeChannel(ch); };
  }, [adminActive, load]);

  useEffect(() => {
    if (!adminActive) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void load();
      if (canManageInvites) void loadInvites();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [adminActive, canManageInvites, load, loadInvites]);

  const approved = useMemo(() => bookings.filter((b) => b.status === "approved"), [bookings]);
  const approvedRows = useMemo(() => getApprovedRows(approved, language), [approved, language]);
  const approvedVisibleRows = useMemo(
    () => approvedRows.filter((row) => isApprovedRowPast(row, Date.now()) === (approvedView === "past")),
    [approvedRows, approvedView],
  );
  const pending = useMemo(() => bookings.filter((b) => b.status === "pending"), [bookings]);

  // Keep the selection honest: when bookings reload (realtime / refresh), drop any
  // selected id that no longer exists so bulk actions never target stale bookings.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(bookings.map((b) => b.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [bookings]);

  const conflictsFor = (b: Booking) =>
    approved.filter((a) => a.id !== b.id && overlaps(
      new Date(b.start_time), new Date(b.end_time),
      new Date(a.start_time), new Date(a.end_time),
    ));

  // The instances of a request that clash with approved bookings. Any clash blocks
  // the whole request's Approve (first-come wins; the admin frees the slot first).
  const clashesFor = (items: Booking[]): PendingClash[] =>
    items
      .map((instance) => ({ instance, holders: conflictsFor(instance) }))
      .filter((clash) => clash.holders.length > 0);

  const isActionBusy = useCallback((key: string) => busyActions.has(key), [busyActions]);

  const runAdminAction = useCallback(async (key: string, action: () => Promise<void>) => {
    if (busyActionsRef.current.has(key)) return;
    busyActionsRef.current.add(key);
    setBusyActions((current) => new Set(current).add(key));
    try {
      await action();
    } finally {
      busyActionsRef.current.delete(key);
      setBusyActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const adminErrorMessage = (error: unknown, fallback: string) =>
    error instanceof TypeError ? t("common.networkIssue") : fallback;

  const actionKeysFor = (booking: Booking): AdminActionKeys => ({
    approve: `approve:${booking.id}`,
    reject: `reject:${booking.id}`,
    delete: `delete:${booking.id}`,
    deleteFollowing: `delete-following:${booking.id}`,
  });

  const approve = async (b: Booking) => {
    const key = `approve:${b.id}`;
    await runAdminAction(key, async () => {
      if (!(await ensureAdminSession())) return;
      setBookings((prev) => prev.map((x) => x.id === b.id ? { ...x, status: "approved" } : x));
      try {
        await approveBooking(b.id);
        toast.success(t("admin.approvedToast"));
        await load();
      } catch (error: unknown) {
        toast.error(adminErrorMessage(error, t("admin.approveFailed")));
        await load();
      }
    });
  };

  const reject = (b: Booking) => {
    setPendingRejectDelete(b);
  };

  const confirmRejectDelete = async () => {
    if (!pendingRejectDelete) return;
    const target = pendingRejectDelete;
    const key = `reject:${target.id}`;
    await runAdminAction(key, async () => {
      if (!(await ensureAdminSession())) return;
      setPendingRejectDelete(null);
      setBookings((prev) => prev.filter((x) => x.id !== target.id));
      try {
        await deletePendingBooking(target.id);
        toast.success(t("admin.deletedToast"));
        await load();
      } catch (error: unknown) {
        toast.error(adminErrorMessage(error, t("common.couldNotDelete")));
        await load();
      }
    });
  };

  // Atomic group approval: the whole request approves in one RPC transaction, or
  // none of it does. The UI never calls this while the group clashes (Approve is
  // blocked); the DB no_approved_overlap constraint is the concurrency backstop.
  const approveGroup = async (groupId: string, items: Booking[]) => {
    const key = `approve-group:${groupId}`;
    await runAdminAction(key, async () => {
      if (!(await ensureAdminSession())) return;
      if (clashesFor(items).length > 0) return; // blocked; never overwrite
      const itemIds = new Set(items.map((it) => it.id));
      setBookings((prev) => prev.map((x) => (itemIds.has(x.id) ? { ...x, status: "approved" } : x)));
      try {
        await approveBookingGroup(groupId);
        toast.success(t("admin.approvedToast"));
        await load();
      } catch (error: unknown) {
        toast.error(adminErrorMessage(error, t("admin.approveFailed")));
        await load();
      }
    });
  };

  // Header "Approve all": approves every REQUEST with no clash — groups atomically
  // via the group RPC, singles individually. Clashing requests are skipped and stay
  // pending with their on-card blocked banner; the toast reports both counts.
  const approveAllClear = async () => {
    const key = "approve-all";
    await runAdminAction(key, async () => {
      if (!(await ensureAdminSession())) return;
      const groups = new Map<string, Booking[]>();
      const singles: Booking[] = [];
      for (const item of pending) {
        if (item.group_id) {
          const list = groups.get(item.group_id) ?? [];
          list.push(item);
          groups.set(item.group_id, list);
        } else {
          singles.push(item);
        }
      }
      const clearGroups = [...groups.entries()].filter(([, items]) => clashesFor(items).length === 0);
      const clearSingles = singles.filter((item) => conflictsFor(item).length === 0);
      const totalRequests = groups.size + singles.length;
      const clearRequests = clearGroups.length + clearSingles.length;
      const targetIds = new Set([
        ...clearGroups.flatMap(([, items]) => items.map((it) => it.id)),
        ...clearSingles.map((it) => it.id),
      ]);
      setBookings((prev) => prev.map((booking) =>
        targetIds.has(booking.id) ? { ...booking, status: "approved" } : booking,
      ));
      let approvedRequests = 0;
      let failed = 0;
      for (const [groupId] of clearGroups) {
        try {
          await approveBookingGroup(groupId);
          approvedRequests += 1;
        } catch {
          failed += 1; // e.g. lost a race to a concurrent approval (DB constraint)
        }
      }
      for (const target of clearSingles) {
        try {
          await approveBooking(target.id);
          approvedRequests += 1;
        } catch {
          failed += 1;
        }
      }
      await load();
      toast.success(t("admin.bulkApproveResult", {
        approved: approvedRequests,
        skipped: totalRequests - clearRequests + failed,
      }));
    });
  };

  const remove = async (b: Booking) => {
    const key = `delete:${b.id}`;
    await runAdminAction(key, async () => {
      if (!(await ensureAdminSession())) return;
      setPendingDelete(null);
      setBookings((prev) => prev.filter((x) => x.id !== b.id));
      try {
        await deleteBooking(b.id);
        dispatchBookingApprovedChanged({ deletedIds: [b.id] });
        toast.success(t("admin.deletedToast"));
        await load();
      } catch (error: unknown) {
        toast.error(adminErrorMessage(error, t("common.couldNotDelete")));
        await load();
      }
    });
  };

  const removeFromOccurrence = async (b: Booking) => {
    if (!b.group_id) {
      await remove(b);
      return;
    }
    const key = `delete-following:${b.id}`;
    await runAdminAction(key, async () => {
      if (!(await ensureAdminSession())) return;
      if (!b.group_id) return; // "delete following occurrences" only applies to a recurring series
      const deletedIds = bookings
        .filter((booking) => booking.group_id === b.group_id && booking.start_time >= b.start_time)
        .map((booking) => booking.id);
      setPendingDelete(null);
      setBookings((prev) => prev.filter((x) => x.group_id !== b.group_id || x.start_time < b.start_time));
      try {
        await deleteBookingAndFollowingOccurrences(b.group_id, b.start_time);
        dispatchBookingApprovedChanged({ deletedIds });
        toast.success(t("admin.followingDeletedToast"));
        await load();
      } catch (error: unknown) {
        toast.error(adminErrorMessage(error, t("common.couldNotDelete")));
        await load();
      }
    });
  };

  const removeGroup = async (group_id: string) => {
    const key = `delete-series:${group_id}`;
    await runAdminAction(key, async () => {
      if (!(await ensureAdminSession())) return;
      const deletedIds = bookings
        .filter((booking) => booking.group_id === group_id)
        .map((booking) => booking.id);
      setPendingDelete(null);
      setPendingGroupDelete(null);
      setBookings((prev) => prev.filter((x) => x.group_id !== group_id));
      try {
        await deleteBookingSeries(group_id);
        dispatchBookingApprovedChanged({ deletedIds });
        toast.success(t("admin.seriesDeletedToast"));
        await load();
      } catch (error: unknown) {
        toast.error(adminErrorMessage(error, t("common.couldNotDelete")));
        await load();
      }
    });
  };

  const toggleSeries = (groupId: string) => {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // ── Multi-select (Pending: approve+delete · Approved: delete) ────────────────
  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const changeTab = (value: string) => {
    setActiveTab(value);
    exitSelect(); // selection is per-tab; never carry it across.
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Groups select as one unit (a request is atomic): toggling the card toggles
  // every member id together, so bulk actions can never split a group.
  const toggleSelectGroup = (items: Booking[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allIn = items.every((b) => next.has(b.id));
      items.forEach((b) => (allIn ? next.delete(b.id) : next.add(b.id)));
      return next;
    });
  };

  // The bookings selectable in the active tab (pending = all pending; approved =
  // every visible single + series occurrence). Drives Select-all and the toolbar.
  const selectableIds = useMemo(() => {
    if (activeTab === "pending") return pending.map((b) => b.id);
    if (activeTab === "approved") {
      return approvedVisibleRows.flatMap((row) =>
        row.kind === "single" ? [row.booking.id] : row.occurrences.map((o) => o.id),
      );
    }
    return [];
  }, [activeTab, pending, approvedVisibleRows]);

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (selectableIds.length > 0 && selectableIds.every((id) => prev.has(id))) {
        const next = new Set(prev);
        selectableIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...selectableIds]);
    });
  };

  // Bulk approve operates per REQUEST: a selected group approves atomically (its
  // members always select together), a selected single approves alone. Clashing
  // requests are skipped — bulk actions never overwrite an approved booking.
  const bulkApprove = async () => {
    await runAdminAction("bulk-approve", async () => {
      if (!(await ensureAdminSession())) return;
      const chosen = pending.filter((b) => selectedIds.has(b.id));
      const chosenGroups = new Map<string, Booking[]>();
      const chosenSingles: Booking[] = [];
      for (const b of chosen) {
        if (b.group_id) {
          // Approve the FULL group (selection toggles whole groups; stale partial
          // selections must still never split an atomic request).
          if (!chosenGroups.has(b.group_id)) {
            chosenGroups.set(b.group_id, pending.filter((p) => p.group_id === b.group_id));
          }
        } else {
          chosenSingles.push(b);
        }
      }
      const clearGroups = [...chosenGroups.entries()].filter(([, items]) => clashesFor(items).length === 0);
      const clearSingles = chosenSingles.filter((b) => conflictsFor(b).length === 0);
      const totalRequests = chosenGroups.size + chosenSingles.length;
      const targetIds = new Set([
        ...clearGroups.flatMap(([, items]) => items.map((it) => it.id)),
        ...clearSingles.map((it) => it.id),
      ]);
      setBookings((prev) => prev.map((b) => (targetIds.has(b.id) ? { ...b, status: "approved" } : b)));
      let approvedCount = 0;
      let failed = 0;
      for (const [groupId] of clearGroups) {
        try {
          await approveBookingGroup(groupId);
          approvedCount += 1;
        } catch {
          failed += 1; // e.g. a mutual clash inside the batch (DB overlap constraint).
        }
      }
      for (const target of clearSingles) {
        try {
          await approveBooking(target.id);
          approvedCount += 1;
        } catch {
          failed += 1;
        }
      }
      exitSelect();
      await load();
      toast.success(t("admin.bulkApproveResult", {
        approved: approvedCount,
        skipped: totalRequests - clearGroups.length - clearSingles.length + failed,
      }));
    });
  };

  const confirmBulkDelete = async () => {
    setPendingBulkDelete(false);
    await runAdminAction("bulk-delete", async () => {
      if (!(await ensureAdminSession())) return;
      const deletingApproved = activeTab === "approved";
      const chosen = bookings.filter((b) => selectedIds.has(b.id));
      if (chosen.length === 0) return;
      setBookings((prev) => prev.filter((b) => !selectedIds.has(b.id)));
      exitSelect();
      try {
        if (deletingApproved) {
          for (const b of chosen) await deleteBooking(b.id);
        } else {
          // Pending selection is per request: whole groups delete via the series
          // path (which also removes the booking_groups row), singles one by one.
          const groupIds = new Set(chosen.flatMap((b) => (b.group_id ? [b.group_id] : [])));
          for (const groupId of groupIds) await deleteBookingSeries(groupId);
          for (const b of chosen.filter((x) => !x.group_id)) await deletePendingBooking(b.id);
        }
        if (deletingApproved) dispatchBookingApprovedChanged({ deletedIds: chosen.map((b) => b.id) });
        toast.success(t("admin.deletedToast"));
        await load();
      } catch (error: unknown) {
        toast.error(adminErrorMessage(error, t("common.couldNotDelete")));
        await load();
      }
    });
  };

  // Left side of a tab header while selecting: the count + a compact Select-all /
  // Clear toggle. Shared by both tabs so the meta stays in the same fixed slot.
  const renderSelectionMeta = () => (
    <div className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {t("admin.selectedCount", { count: selectedIds.size })}
      </span>
      <HeaderAction
        icon={allSelected ? X : CheckCheck}
        label={allSelected ? t("admin.clear") : t("admin.selectAll")}
        variant="outline"
        onClick={toggleSelectAll}
        disabled={selectableIds.length === 0}
        alwaysLabel
      />
    </div>
  );

  const createInvite = async () => {
    if (inviteBusy) return;
    if (!(await ensureAdminSession())) return;
    setInviteBusy(true);
    try {
      const { code } = await createAdminInvite({
        label: inviteLabel,
        maxUses: inviteMaxUses,
      });
      setGeneratedInvite(code);
      toast.success(t("admin.invite.generated"));
      await loadInvites();
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, t("admin.invite.generateFailed")));
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!generatedInvite) return;
    try {
      await navigator.clipboard.writeText(generatedInvite);
      toast.success(t("admin.invite.copied"));
    } catch {
      toast.error(t("common.couldNotSave"));
    }
  };

  const deactivateInvite = async (invite: AdminInvite) => {
    if (!(await ensureAdminSession())) return;
    try {
      await deactivateAdminInvite(invite.id);
      toast.success(t("admin.invite.deactivated"));
      await loadInvites();
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, t("admin.invite.deactivateFailed")));
      await loadInvites();
    }
  };

  // ── Organisation (owner-only): promote/demote Band Heads, offboard staff ─────
  const toggleBandHead = async (member: StaffMember) => {
    if (staffBusyId) return;
    if (!(await ensureAdminSession())) return;
    setStaffBusyId(member.userId);
    try {
      await setBandHead(member.userId, !member.isHead);
      toast.success(member.isHead ? t("admin.org.headRemoved") : t("admin.org.headAdded"));
      await loadStaffList();
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, t("admin.org.updateFailed")));
    } finally {
      setStaffBusyId(null);
    }
  };

  const confirmDeactivateStaff = async () => {
    const member = pendingStaffDeactivate;
    if (!member || staffBusyId) return;
    setPendingStaffDeactivate(null);
    if (!(await ensureAdminSession())) return;
    setStaffBusyId(member.userId);
    try {
      await setStaffActive(member.userId, false);
      toast.success(t("admin.org.deactivated"));
      await loadStaffList();
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, t("admin.org.updateFailed")));
    } finally {
      setStaffBusyId(null);
    }
  };

  // Reactivation just unbans (no destructive confirm) — restores login.
  const reactivateStaff = async (member: StaffMember) => {
    if (staffBusyId) return;
    if (!(await ensureAdminSession())) return;
    setStaffBusyId(member.userId);
    try {
      await setStaffActive(member.userId, true);
      toast.success(t("admin.org.reactivated"));
      await loadStaffList();
    } catch (error: unknown) {
      toast.error(adminErrorMessage(error, t("admin.org.updateFailed")));
    } finally {
      setStaffBusyId(null);
    }
  };

  const openBookingEditor = (booking: Booking) => {
    setEditing(booking);
    setBookingFormOpen(true);
  };

  const handleBookingFormSubmitted = (result: BookingFormSubmitResult) => {
    if (result.type === "created-approved" || result.type === "updated-approved") {
      const returnedById = new Map(result.bookings.map((booking) => [booking.id, booking]));
      setBookings((current) => {
        const nextById = new Map<string, Booking>();
        current.forEach((booking) => {
          if (returnedById.has(booking.id)) return;
          nextById.set(booking.id, booking);
        });
        result.bookings.forEach((booking) => nextById.set(booking.id, booking));
        return Array.from(nextById.values()).sort(
          (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
        );
      });
      dispatchBookingApprovedChanged({ bookings: result.bookings });
    }
    void load();
  };

  if (!authChecked) {
    return (
      <PageShell className="font-sans text-foreground">
        <div className="px-4 pt-8">
          <div className="relative z-10 mx-auto grid min-h-44 max-w-5xl place-items-center rounded-lg border border-border bg-card text-sm text-muted-foreground shadow-md">
            {t("common.loading")}
          </div>
        </div>
      </PageShell>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/?admin=login&next=/admin" replace />;
  }

  const pendingGroups: Record<string, Booking[]> = {};
  const pendingSingles: Booking[] = [];
  for (const p of pending) {
    if (p.group_id) (pendingGroups[p.group_id] ||= []).push(p);
    else pendingSingles.push(p);
  }
  // "Approve all" only does something when at least one request is clash-free —
  // otherwise it's greyed out, matching each blocked request's disabled Approve.
  const hasApprovableRequest =
    pendingSingles.some((b) => conflictsFor(b).length === 0) ||
    Object.values(pendingGroups).some((items) => clashesFor(items).length === 0);

  return (
    <PageShell className="font-sans text-foreground">
      <PageHeaderBar
        title={t("nav.manage")}
        containerClassName="max-w-7xl"
        actions={
          // Display-name editor lives in the header, right-aligned on desktop and
          // full-width under the title on mobile (PageHeaderBar handles the stretch).
          <div className="flex items-center gap-2">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={ADMIN_DISPLAY_NAME_MAX}
              placeholder={t("admin.profile.placeholder")}
              aria-label={t("admin.profile.title")}
              className="h-10 min-w-0 flex-1 sm:w-44 sm:flex-none"
            />
            <Button
              onClick={saveDisplayName}
              disabled={savingName || !displayName.trim() || !nameDirty}
              className="shrink-0 rounded-full"
            >
              {savingName ? t("admin.profile.saving") : t("admin.profile.save")}
            </Button>
          </div>
        }
      >
        <p className="mt-2 truncate text-xs text-muted-foreground sm:text-sm">{userEmail}</p>
      </PageHeaderBar>
      <main className="relative z-10 mx-auto w-full max-w-7xl space-y-6 px-3 pb-6 pt-6 sm:px-6 sm:pb-9 sm:pt-9">
        {/* Mobile order: title + name (header) → add booking → weekly → pending tabs. */}
        <div className="flex">
          <Button
            onPointerEnter={preloadBookingForm}
            onFocus={preloadBookingForm}
            onClick={() => {
              preloadBookingForm();
              setEditing(null);
              setBookingFormOpen(true);
            }}
            className="h-11 w-full rounded-full px-5 text-sm shadow-md transition-shadow duration-fast hover:shadow-lg sm:w-auto"
          >
            <Plus className="h-4 w-4" /> {t("admin.addBooking")}
          </Button>
        </div>

        <div>
          <AdminWeekView bookings={approved} onSelectDay={setSelectedDay} />
        </div>

        <div>
          <Tabs value={activeTab} onValueChange={changeTab}>
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-lg">
              <div className="overflow-x-auto border-b border-border p-2 sm:p-2.5">
                <TabsList className="h-auto justify-start gap-1 bg-transparent p-0 text-muted-foreground shadow-none">
              <TabsTrigger
                className="rounded-full px-4 py-2 data-[state=active]:bg-interactive data-[state=active]:text-interactive-text"
                value="pending"
              >
                {t("admin.pending")} ({pending.length})
              </TabsTrigger>
              <TabsTrigger
                className="rounded-full px-4 py-2 data-[state=active]:bg-interactive data-[state=active]:text-interactive-text"
                value="approved"
              >
                {t("admin.approved")} ({approved.length})
              </TabsTrigger>
              {canManageInvites && (
                <TabsTrigger
                  className="rounded-full px-4 py-2 data-[state=active]:bg-interactive data-[state=active]:text-interactive-text"
                  value="invites"
                >
                  {t("admin.invites")}
                </TabsTrigger>
              )}
              {isOwner && (
                <TabsTrigger
                  className="rounded-full px-4 py-2 data-[state=active]:bg-interactive data-[state=active]:text-interactive-text"
                  value="organisation"
                >
                  {t("admin.org.tab")}
                </TabsTrigger>
              )}
                </TabsList>
              </div>

            <TabsContent value="pending">
              <div>
                {/* Fixed-height, single-line header: the left meta + the right action
                    slot never wrap, so the height stays put across idle/select modes. */}
                <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
                  {selectMode ? (
                    renderSelectionMeta()
                  ) : (
                    <span className="truncate text-sm text-muted-foreground">
                      {pending.length} request{pending.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <div
                    key={selectMode ? "select" : "idle"}
                    className="flex shrink-0 items-center gap-1.5 animate-in fade-in-0 duration-base"
                  >
                    {selectMode ? (
                      <>
                        <HeaderAction
                          icon={Check}
                          label={t("admin.approveSelected")}
                          onClick={bulkApprove}
                          disabled={selectedIds.size === 0 || isActionBusy("bulk-approve")}
                          alwaysLabel
                        />
                        <HeaderAction
                          icon={Trash2}
                          label={t("admin.deleteSelected")}
                          variant="outline"
                          onClick={() => setPendingBulkDelete(true)}
                          disabled={selectedIds.size === 0 || isActionBusy("bulk-delete")}
                        />
                        <HeaderAction icon={X} label={t("common.cancel")} variant="ghost" onClick={exitSelect} />
                      </>
                    ) : (
                      pending.length > 0 && (
                        <>
                          <HeaderAction
                            icon={Check}
                            label={t("admin.approveAll")}
                            onClick={approveAllClear}
                            disabled={isActionBusy("approve-all") || !hasApprovableRequest}
                            alwaysLabel
                          />
                          <HeaderAction
                            icon={ListChecks}
                            label={t("admin.select")}
                            variant="outline"
                            onClick={() => setSelectMode(true)}
                          />
                        </>
                      )
                    )}
                  </div>
                </div>

                {pending.length === 0 && (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    {t("admin.noPendingRequests")}
                  </div>
                )}

                {Object.entries(pendingGroups).map(([gid, items]) => (
                  <PendingGroupCard
                    key={gid}
                    groupId={gid}
                    items={items}
                    language={language}
                    clashes={clashesFor(items)}
                    onApprove={approveGroup}
                    onDelete={(target) => setPendingGroupDelete(target)}
                    approveBusy={isActionBusy(`approve-group:${gid}`)}
                    deleteBusy={isActionBusy(`delete-series:${gid}`)}
                    selectable={selectMode}
                    selected={items.every((b) => selectedIds.has(b.id))}
                    onToggleSelect={() => toggleSelectGroup(items)}
                  />
                ))}

                {pendingSingles.map((b) => (
                  <div key={b.id} className="border-t border-border p-4">
                    <PendingItem
                      b={b}
                      language={language}
                      conflicts={conflictsFor(b)}
                      onApprove={approve}
                      onReject={reject}
                      busy={actionKeysFor(b)}
                      isActionBusy={isActionBusy}
                      selectable={selectMode}
                      selected={selectedIds.has(b.id)}
                      onToggleSelect={() => toggleSelect(b.id)}
                    />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="approved">
              <div>
                {/* Same fixed-height single-line header contract as Pending. */}
                <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
                  {selectMode ? (
                    renderSelectionMeta()
                  ) : (
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <div className="inline-flex shrink-0 rounded-full border border-border bg-background p-1">
                        <Button
                          type="button"
                          size="sm"
                          variant={approvedView === "current" ? "default" : "ghost"}
                          onClick={() => setApprovedView("current")}
                          className="rounded-full"
                        >
                          {t("admin.current")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={approvedView === "past" ? "default" : "ghost"}
                          onClick={() => setApprovedView("past")}
                          className="rounded-full"
                        >
                          {t("admin.past")}
                        </Button>
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {approvedVisibleRows.length} booking{approvedVisibleRows.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                  <div
                    key={selectMode ? "select" : "idle"}
                    className="flex shrink-0 items-center gap-1.5 animate-in fade-in-0 duration-base"
                  >
                    {selectMode ? (
                      <>
                        <HeaderAction
                          icon={Trash2}
                          label={t("admin.deleteSelected")}
                          variant="outline"
                          onClick={() => setPendingBulkDelete(true)}
                          disabled={selectedIds.size === 0 || isActionBusy("bulk-delete")}
                        />
                        <HeaderAction icon={X} label={t("common.cancel")} variant="ghost" onClick={exitSelect} />
                      </>
                    ) : (
                      approvedVisibleRows.length > 0 && (
                        <HeaderAction
                          icon={ListChecks}
                          label={t("admin.select")}
                          variant="outline"
                          onClick={() => setSelectMode(true)}
                        />
                      )
                    )}
                  </div>
                </div>

                {approvedVisibleRows.length === 0 && (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                    {t("admin.noApprovedBookings")}
                  </div>
                )}

                {approvedVisibleRows.map((row) =>
                  row.kind === "single" ? (
                    <div key={row.booking.id} className="border-t border-border px-3 py-2">
                      <BookingRow
                        b={row.booking}
                        language={language}
                        onEdit={() => openBookingEditor(row.booking)}
                        onDelete={() => setPendingDelete(row.booking)}
                        deleteBusy={isActionBusy(`delete:${row.booking.id}`)}
                        selectable={selectMode}
                        selected={selectedIds.has(row.booking.id)}
                        onToggleSelect={() => toggleSelect(row.booking.id)}
                      />
                    </div>
                  ) : (
                    <div key={row.groupId} className="border-t border-border">
                      <ApprovedSeriesRow
                        series={row}
                        language={language}
                        expanded={expandedSeries.has(row.groupId)}
                        onToggle={() => toggleSeries(row.groupId)}
                        onDeleteSeries={() => setPendingGroupDelete({
                          groupId: row.groupId,
                          name: row.name,
                          count: row.occurrences.length,
                          kind: row.representative.group_kind === "custom" ? "custom" : "pattern",
                        })}
                        onEdit={openBookingEditor}
                        onDeleteOccurrence={(booking) => setPendingDelete(booking)}
                        isActionBusy={isActionBusy}
                        selectable={selectMode}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                      />
                    </div>
                  ),
                )}
              </div>
            </TabsContent>

            {canManageInvites && (
              <TabsContent value="invites" className="space-y-4 p-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-interactive text-interactive-text">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <h2 className="text-base font-semibold text-foreground">
                      {t("admin.invite.generateTitle")}
                    </h2>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)]">
                    <div className="space-y-1.5">
                      <Label htmlFor="invite-label">{t("admin.invite.label")}</Label>
                      <Input
                        id="invite-label"
                        value={inviteLabel}
                        onChange={(e) => setInviteLabel(e.target.value)}
                        maxLength={255}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="invite-max">{t("admin.invite.maxUses")}</Label>
                      <Input
                        id="invite-max"
                        type="number"
                        min={1}
                        max={20}
                        value={inviteMaxUses}
                        onChange={(e) => setInviteMaxUses(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </div>
                  </div>
                  {/* Lifetime is fixed, not chosen — stated here so the person handing
                      the code over knows the window without hunting for the row. */}
                  <p className="text-xs text-muted-foreground">
                    {t("admin.invite.expiryNote", { days: INVITE_EXPIRY_DAYS })}
                  </p>
                  <Button
                    onClick={createInvite}
                    disabled={inviteBusy}
                    className="w-full rounded-full sm:w-auto"
                  >
                    <KeyRound className="h-4 w-4" />{" "}
                    {inviteBusy ? t("admin.invite.generating") : t("admin.invite.generate")}
                  </Button>

                  {generatedInvite && (
                    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground">{t("admin.invite.shownOnce")}</div>
                        <div className="break-all font-mono text-base tracking-wide sm:text-lg">
                          {generatedInvite}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        onClick={copyInvite}
                        className="w-full rounded-full sm:w-auto"
                      >
                        <Copy className="h-4 w-4" /> {t("admin.invite.copy")}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {invites.length === 0 && (
                    <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                      {t("admin.invite.none")}
                    </div>
                  )}
                  {invites.map((invite) => (
                    <InviteRow
                      key={invite.id}
                      invite={invite}
                      language={language}
                      onDeactivate={() => deactivateInvite(invite)}
                    />
                  ))}
                </div>
              </TabsContent>
            )}

            {isOwner && (
              <TabsContent value="organisation" className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-interactive text-interactive-text">
                    <Users className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{t("admin.org.title")}</h2>
                    <p className="text-xs text-muted-foreground">{t("admin.org.subtitle")}</p>
                  </div>
                </div>

                {staff.length === 0 ? (
                  <div className="px-1 py-8 text-center text-sm text-muted-foreground">{t("admin.org.empty")}</div>
                ) : (
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {staff.map((member) => {
                      const tierLabel = member.isOwner
                        ? t("admin.org.tierOwner")
                        : member.isHead
                          ? t("admin.org.tierHead")
                          : t("admin.org.tierLeader");
                      const tierCaps = member.isOwner
                        ? t("admin.org.capsOwner")
                        : member.isHead
                          ? t("admin.org.capsHead")
                          : t("admin.org.capsLeader");
                      const busy = staffBusyId === member.userId;
                      return (
                        <li key={member.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{sanitizeDisplayText(member.displayName)}</div>
                            {member.email && (
                              <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                            )}
                            <span className="mt-1 inline-flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex rounded-full border bg-background/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                {tierLabel}
                              </span>
                              {member.isBanned && (
                                <span className="inline-flex rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                                  {t("admin.org.tierDeactivated")}
                                </span>
                              )}
                            </span>
                            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{tierCaps}</p>
                          </div>
                          {!member.isOwner && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-9 w-9 shrink-0 px-0" disabled={busy} aria-label={t("admin.org.manage")}>
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent align="end" className="w-56 p-1">
                                {member.isBanned ? (
                                  <button
                                    type="button"
                                    onClick={() => reactivateStaff(member)}
                                    disabled={busy}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                                  >
                                    <UserCheck className="h-4 w-4" />
                                    {t("admin.org.reactivate")}
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => toggleBandHead(member)}
                                      disabled={busy}
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                                    >
                                      {member.isHead ? <UserMinus className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                                      {member.isHead ? t("admin.org.removeHead") : t("admin.org.makeHead")}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setPendingStaffDeactivate(member)}
                                      disabled={busy}
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                                    >
                                      <UserX className="h-4 w-4" />
                                      {t("admin.org.deactivate")}
                                    </button>
                                  </>
                                )}
                              </PopoverContent>
                            </Popover>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>
            )}
            </div>
          </Tabs>
        </div>
      </main>

      <DayDetailDialog
        day={selectedDay}
        bookings={approved}
        onClose={() => setSelectedDay(null)}
        onEditBooking={(booking) => {
          setSelectedDay(null);
          setEditing(booking);
          setBookingFormOpen(true);
        }}
        onDeleteBooking={(booking) => {
          // Hand off to the page's existing confirm, which owns the single-vs-series
          // fork; closing the day dialog first keeps one modal on screen at a time.
          setSelectedDay(null);
          setPendingDelete(booking);
        }}
      />

      <Suspense fallback={null}>
        <LazyBookingForm
          open={bookingFormOpen || !!editing}
          onClose={() => {
            setBookingFormOpen(false);
            setEditing(null);
          }}
          approvedBookings={approved}
          editing={editing}
          adminMode
          ensureAdminSession={ensureAdminSession}
          onSubmitted={handleBookingFormSubmitted}
        />
      </Suspense>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.deleteBookingTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {pendingDelete?.group_id
                ? t("admin.deleteBookingSeriesDescription")
                : t("admin.deleteWarning")}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            {pendingDelete?.group_id && (
              <Button
                variant="outline"
                onClick={() => pendingDelete && removeFromOccurrence(pendingDelete)}
                disabled={pendingDelete ? isActionBusy(`delete-following:${pendingDelete.id}`) : false}
                className="w-full sm:w-auto"
              >
                {t("admin.deleteThisAndFollowing")}
              </Button>
            )}
            <AlertDialogAction
              disabled={pendingDelete ? isActionBusy(`delete:${pendingDelete.id}`) : false}
              onClick={() => pendingDelete && remove(pendingDelete)}
            >
              {pendingDelete?.group_id ? t("admin.deleteThisOccurrence") : t("admin.deleteBooking")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One confirm for every whole-group delete — pending or approved, recurring
          or pick-dates — so no group ever deletes on a single tap (B3). */}
      <AlertDialog open={!!pendingGroupDelete} onOpenChange={(open) => !open && setPendingGroupDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingGroupDelete?.kind === "custom"
                ? t("admin.deleteCustomGroupTitle")
                : t("admin.deleteRecurringSeriesTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {t("admin.deleteGroupDescription", {
                count: pendingGroupDelete?.count ?? 0,
                name: sanitizeDisplayText(pendingGroupDelete?.name),
              })}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingGroupDelete ? isActionBusy(`delete-series:${pendingGroupDelete.groupId}`) : false}
              onClick={() => pendingGroupDelete && removeGroup(pendingGroupDelete.groupId)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingRejectDelete} onOpenChange={(open) => !open && setPendingRejectDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.deletePendingRequestTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {t("admin.deletePendingRequestDescription", {
                name: sanitizeDisplayText(pendingRejectDelete?.name),
              })}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingRejectDelete ? isActionBusy(`reject:${pendingRejectDelete.id}`) : false}
              onClick={confirmRejectDelete}
            >
              {t("admin.reject")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingStaffDeactivate} onOpenChange={(open) => !open && setPendingStaffDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.org.deactivateTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {t("admin.org.deactivateDescription", {
                name: sanitizeDisplayText(pendingStaffDeactivate?.displayName),
              })}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!staffBusyId}
              onClick={confirmDeactivateStaff}
            >
              {t("admin.org.deactivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingBulkDelete} onOpenChange={(open) => !open && setPendingBulkDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.bulkDeleteTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {t("admin.bulkDeleteDescription", { count: selectedIds.size })}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isActionBusy("bulk-delete")}
              onClick={confirmBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("admin.deleteSelected")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
};

// Circular selection control — a filled interactive disc with a check when on, a
// hollow ring when off. Purely visual; the enclosing row owns the toggle + a11y.
const SelectionCircle = ({ selected }: { selected: boolean }) => (
  <span
    aria-hidden
    className={cn(
      "grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-fast",
      selected
        ? "border-interactive bg-interactive text-interactive-text"
        : "border-muted-foreground/40 text-transparent",
    )}
  >
    <Check className="h-3.5 w-3.5" strokeWidth={3} />
  </span>
);

// Space/Enter toggles a row acting as a checkbox (mouse/touch use onClick).
const selectionKeyDown = (event: ReactKeyboardEvent, onToggle?: () => void) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    onToggle?.();
  }
};

// Blocked-approval banner — the same persistent "reason next to the disabled CTA"
// affordance the public BookingForm ships (BookingForm.tsx conflict warning): a
// role="alert" panel that names the clashing date and who holds the approved slot,
// plus the fix. Visible without hover (mobile-first); never fades on its own.
// Conflicts section: a heading + one red pill per blocking booking, each naming
// the clashing date and the approved booking (title + booker) holding it — so the
// admin sees exactly which sessions are blocked and what to free. Minimal (no
// alert box), used for every pending kind (single / weekly / pick-dates).
const ConflictBanner = ({ clashes, language }: { clashes: PendingClash[]; language: string }) => {
  const { t } = useI18n();
  const pills = clashes.flatMap((clash) =>
    clash.holders.map((holder) => ({
      key: `${clash.instance.id}-${holder.id}`,
      date: fmtDate(new Date(clash.instance.start_time), language),
      title: sanitizeDisplayText(holder.title),
      name: sanitizeDisplayText(holder.name),
    })),
  );
  return (
    <div role="alert" className="space-y-1.5">
      <p className="text-xs font-medium text-destructive">{t("admin.conflicts")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {pills.map((pill) => (
          <li key={pill.key}>
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              <span className="tabular-nums">{pill.date}</span> · {pill.title} ({pill.name})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// Pick-dates: a "Dates:" label + every hand-picked day as a small tag, wrapping.
// Grey by default (unobtrusive — the count/time carry the weight), red when the
// date clashes with an approved booking (the Conflicts section names the holder).
// Capped at 10 by the form, so they wrap without paging.
const DatePillGrid = ({
  items,
  clashIds,
  language,
}: {
  items: Booking[];
  clashIds: Set<string>;
  language: string;
}) => {
  const { t } = useI18n();
  return (
    <div className="space-y-0.5">
      <span className="text-sm text-muted-foreground">{t("bookingForm.reviewDates")}:</span>
      <ul className="flex flex-wrap gap-1">
        {items.map((b) => {
          const clash = clashIds.has(b.id);
          return (
            <li key={b.id}>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
                  clash
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {clash && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
                {formatLocalizedDate(new Date(b.start_time), language, "d MMM", "M月d日")}
                {clash && <span className="sr-only">{t("admin.dateTaken")}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// One pending REQUEST spanning several dates (recurring pattern or pick-dates).
// Atomic: a single Approve for the whole group (blocked while any date clashes
// with an approved booking — first-come wins, never overwrite) and a single
// Delete that routes through the shared confirm dialog. Dates are display-only.
const PendingGroupCard = ({
  groupId,
  items,
  language,
  clashes,
  onApprove,
  onDelete,
  approveBusy,
  deleteBusy,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  groupId: string;
  items: Booking[];
  language: string;
  clashes: PendingClash[];
  onApprove: (groupId: string, items: Booking[]) => void;
  onDelete: (target: GroupDeleteTarget) => void;
  approveBusy: boolean;
  deleteBusy: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) => {
  const { t } = useI18n();
  const first = items[0];
  if (!first) return null;
  const kind: GroupDeleteTarget["kind"] = first.group_kind === "custom" ? "custom" : "pattern";
  const blocked = clashes.length > 0;
  const clashIds = new Set(clashes.map((clash) => clash.instance.id));

  return (
    <div className="border-t border-border p-4">
      <div
        onClick={selectable ? onToggleSelect : undefined}
        onKeyDown={selectable ? (e) => selectionKeyDown(e, onToggleSelect) : undefined}
        role={selectable ? "checkbox" : undefined}
        aria-checked={selectable ? selected : undefined}
        aria-label={selectable ? sanitizeDisplayText(first.title) : undefined}
        tabIndex={selectable ? 0 : undefined}
        className={cn(
          "space-y-2.5 rounded-md border border-border bg-muted p-3",
          selectable &&
            "cursor-pointer transition-transform duration-tap outline-none active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-interactive",
          selected && "ring-2 ring-interactive",
        )}
      >
        <div>
          <div className="flex items-center gap-2">
            {selectable && <SelectionCircle selected={selected} />}
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: bookingDot(first) }} />
            <div className="min-w-0 flex-1 truncate font-semibold text-foreground">
              {sanitizeDisplayText(first.title)}
            </div>
          </div>
          <div className="mt-1 space-y-0.5">
            {kind === "pattern" ? (
              // Weekly is self-describing: Date is the weekday, Time below.
              // Clashing sessions surface in the Conflicts section, not a date list.
              <p className="text-sm">
                <span className="text-muted-foreground">{t("bookingForm.date")}: </span>
                <span className="font-semibold text-foreground">
                  {t("common.everyDay", { day: formatLocalizedDate(new Date(first.start_time), language, "EEEE", "EEEE") })}
                </span>
              </p>
            ) : null}
            <p className="text-sm">
              <span className="text-muted-foreground">{t("day.time")}: </span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatClockRange(new Date(first.start_time), new Date(first.end_time), language)}
              </span>
            </p>
            {/* Pick-dates: every picked day shown so the admin sees them when approving. */}
            {kind !== "pattern" && <DatePillGrid items={items} clashIds={clashIds} language={language} />}
            <p className="text-xs text-muted-foreground">
              {t("day.bookedBy")}: {sanitizeDisplayText(first.name)}
            </p>
          </div>
        </div>

        {blocked && <ConflictBanner clashes={clashes} language={language} />}

        {!selectable && (
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              onClick={() => onApprove(groupId, items)}
              disabled={approveBusy || blocked}
              className="rounded-full"
            >
              <Check className="h-4 w-4" /> {t("admin.approve")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete({ groupId, name: first.name, count: items.length, kind })}
              disabled={deleteBusy}
              className="rounded-full"
            >
              <X className="h-4 w-4" /> {t("admin.reject")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const PendingItem = ({
  b,
  language,
  conflicts,
  onApprove,
  onReject,
  busy,
  isActionBusy,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  b: Booking;
  language: string;
  conflicts: Booking[];
  onApprove: (b: Booking) => void;
  onReject: (b: Booking) => void;
  busy: AdminActionKeys;
  isActionBusy: (key: string) => boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) => {
  const { t } = useI18n();
  const blocked = conflicts.length > 0;
  return (
    <div
      onClick={selectable ? onToggleSelect : undefined}
      onKeyDown={selectable ? (e) => selectionKeyDown(e, onToggleSelect) : undefined}
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? selected : undefined}
      aria-label={selectable ? sanitizeDisplayText(b.title) : undefined}
      tabIndex={selectable ? 0 : undefined}
      className={cn(
        "space-y-2.5 rounded-md border border-border bg-muted p-3",
        selectable &&
          "cursor-pointer transition-transform duration-tap outline-none active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-interactive",
        selected && "ring-2 ring-interactive",
      )}
    >
      <div>
        <div className="flex items-center gap-2">
          {selectable && <SelectionCircle selected={selected} />}
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: bookingDot(b) }} />
          <div className="min-w-0 flex-1 truncate font-semibold text-foreground">
            {sanitizeDisplayText(b.title)}
          </div>
        </div>
        <div className="mt-1 space-y-0.5">
          {isMultiDay(new Date(b.start_time), new Date(b.end_time)) ? (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("day.time")}: </span>
              <span className="font-semibold tabular-nums text-foreground">
                {fmtBookingSpan(new Date(b.start_time), new Date(b.end_time), language)}
              </span>
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("bookingForm.date")}: </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatLocalizedDate(new Date(b.start_time), language, "EEE, MMM d", "M 月 d 日 EEE")}
                </span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("day.time")}: </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatClockRange(new Date(b.start_time), new Date(b.end_time), language)}
                </span>
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            {t("day.bookedBy")}: {sanitizeDisplayText(b.name)}
          </p>
        </div>
      </div>
      {/* Approve stays BLOCKED (never an overwrite) while the slot is held — the
          Conflicts section above names what to free. */}
      {blocked && <ConflictBanner clashes={[{ instance: b, holders: conflicts }]} language={language} />}
      {!selectable && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            onClick={() => onApprove(b)}
            disabled={isActionBusy(busy.approve) || blocked}
            className="rounded-full"
          >
            <Check className="h-4 w-4" /> {t("admin.approve")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onReject(b)}
            disabled={isActionBusy(busy.reject)}
            className="rounded-full"
          >
            <X className="h-4 w-4" /> {t("admin.reject")}
          </Button>
        </div>
      )}
    </div>
  );
};

const BookingRow = ({
  b,
  language,
  onEdit,
  onDelete,
  showStatus,
  deleteBusy = false,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  b: Booking;
  language: string;
  onEdit: () => void;
  onDelete: () => void;
  showStatus?: boolean;
  deleteBusy?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) => {
  const { t } = useI18n();
  return (
    <div
      onClick={selectable ? onToggleSelect : undefined}
      onKeyDown={selectable ? (e) => selectionKeyDown(e, onToggleSelect) : undefined}
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? selected : undefined}
      aria-label={selectable ? sanitizeDisplayText(b.title) : undefined}
      tabIndex={selectable ? 0 : undefined}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        selectable &&
          "cursor-pointer transition-transform duration-tap outline-none active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-interactive",
        selected && "ring-2 ring-interactive",
      )}
      style={{ backgroundColor: bookingBg(b), borderColor: bookingBorder(b) }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {selectable && <SelectionCircle selected={selected} />}
        <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: bookingDot(b) }} />
          <div className="truncate font-semibold">{sanitizeDisplayText(b.title)}</div>
          {showStatus && (
            <span className="rounded-full border bg-background/60 px-2 py-0.5 type-badge">
              {t(statusKeyFor(b.status))}
            </span>
          )}
        </div>
        <div className="mt-1 space-y-0.5">
          {isMultiDay(new Date(b.start_time), new Date(b.end_time)) ? (
            <p className="break-words text-sm">
              <span className="text-muted-foreground">{t("day.time")}: </span>
              <span className="font-semibold tabular-nums">
                {fmtBookingSpan(new Date(b.start_time), new Date(b.end_time), language)}
              </span>
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("bookingForm.date")}: </span>
                <span className="font-semibold tabular-nums">
                  {fmtDate(b.start_time, language, true)}
                </span>
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">{t("day.time")}: </span>
                <span className="font-semibold tabular-nums">
                  {formatClockRange(new Date(b.start_time), new Date(b.end_time), language)}
                </span>
              </p>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            {t("day.bookedBy")}: {sanitizeDisplayText(b.name)}
          </p>
          {b.status === "approved" && b.approved_by_name && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3 shrink-0" />
              {t("admin.approvedBy", { name: sanitizeDisplayText(b.approved_by_name) })}
            </p>
          )}
        </div>
        </div>
      </div>
      {!selectable && (
      <div className="flex gap-1 sm:justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={onEdit}
          aria-label={t("common.edit")}
          className="rounded-full"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={deleteBusy}
          aria-label={t("common.delete")}
          className="rounded-full"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      )}
    </div>
  );
};

// One occurrence inside an expanded approved series: a compact rectangle (two per
// row) with just date + time — the title/name/colour live on the series header.
// Keeps BookingRow's edit/delete actions and bulk-select semantics.
const OccurrenceCard = ({
  b,
  language,
  onEdit,
  onDelete,
  deleteBusy = false,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  b: Booking;
  language: string;
  onEdit: () => void;
  onDelete: () => void;
  deleteBusy?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) => {
  const { t } = useI18n();
  const multiDay = isMultiDay(new Date(b.start_time), new Date(b.end_time));
  return (
    <div
      onClick={selectable ? onToggleSelect : undefined}
      onKeyDown={selectable ? (e) => selectionKeyDown(e, onToggleSelect) : undefined}
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? selected : undefined}
      aria-label={selectable ? sanitizeDisplayText(b.title) : undefined}
      tabIndex={selectable ? 0 : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-lg border p-2.5 shadow-sm",
        selectable &&
          "cursor-pointer transition-transform duration-tap outline-none active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-interactive",
        selected && "ring-2 ring-interactive",
      )}
      style={{ backgroundColor: bookingBg(b), borderColor: bookingBorder(b) }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {selectable && <SelectionCircle selected={selected} />}
          <span className="truncate text-xs font-semibold tabular-nums">
            {multiDay
              ? fmtBookingSpan(new Date(b.start_time), new Date(b.end_time), language)
              : formatLocalizedDate(new Date(b.start_time), language, "EEE, MMM d", "M 月 d 日 EEE")}
          </span>
        </div>
        {!selectable && (
          <div className="flex shrink-0 gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={onEdit}
              aria-label={t("common.edit")}
              className="h-7 w-7 rounded-full p-0"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDelete}
              disabled={deleteBusy}
              aria-label={t("common.delete")}
              className="h-7 w-7 rounded-full p-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {!multiDay && (
        <span className="text-xs tabular-nums text-foreground/70">
          {formatClockRange(new Date(b.start_time), new Date(b.end_time), language)}
        </span>
      )}
    </div>
  );
};

const ApprovedSeriesRow = ({
  series,
  language,
  expanded,
  onToggle,
  onDeleteSeries,
  onEdit,
  onDeleteOccurrence,
  isActionBusy,
  selectable = false,
  selectedIds,
  onToggleSelect,
}: {
  series: ApprovedSeries;
  language: string;
  expanded: boolean;
  onToggle: () => void;
  onDeleteSeries: () => void;
  onEdit: (booking: Booking) => void;
  onDeleteOccurrence: (booking: Booking) => void;
  isActionBusy: (key: string) => boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) => {
  const { t } = useI18n();

  // Occurrences paginate so a long series never floods the page (mobile-first):
  // compact cards two per row, two rows per page.
  const PAGE_SIZE = 4;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(series.occurrences.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageItems = series.occurrences.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <>
      <div className="px-3 py-2">
        <div
          className="flex flex-col gap-3 rounded-lg border p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
          style={{ backgroundColor: bookingBg(series.representative), borderColor: bookingBorder(series.representative) }}
        >
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left transition-colors sm:items-center"
            aria-expanded={expanded}
          >
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-background/60 text-foreground/70 transition-colors hover:bg-background sm:mt-0">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: bookingDot(series.representative) }}
                />
                <span className="break-words font-semibold">{sanitizeDisplayText(series.title)}</span>
                {/* Bold count pill — just the number; the range (weekly) sits at
                    the bottom, the picked days (multi-date) live in the expand. */}
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-sm font-bold tabular-nums">
                  {series.occurrences.length}
                </span>
              </span>
              {/* One uniform block: range (recurring) above Date, important info
                  (Date/Time) a step larger than the meta below. */}
              <span className="mt-1 block space-y-0.5">
                {series.representative.group_kind !== "custom" && (
                  <span className="block break-words text-xs tabular-nums text-muted-foreground">
                    {series.dateRangeLabel}
                  </span>
                )}
                {series.representative.group_kind !== "custom" && (
                  <span className="block break-words text-sm">
                    <span className="text-muted-foreground">{t("bookingForm.date")}: </span>
                    <span className="font-semibold">
                      {t("common.everyDay", { day: formatLocalizedDate(new Date(series.representative.start_time), language, "EEEE", "EEEE") })}
                    </span>
                  </span>
                )}
                <span className="block break-words text-sm">
                  <span className="text-muted-foreground">{t("day.time")}: </span>
                  <span className="font-semibold tabular-nums">
                    {formatClockRange(new Date(series.representative.start_time), new Date(series.representative.end_time), language)}
                  </span>
                </span>
                <span className="block break-words text-xs text-foreground/70">
                  {t("day.bookedBy")}: {sanitizeDisplayText(series.name)}
                </span>
                {series.representative.approved_by_name && (
                  <span className="flex items-center gap-1 break-words text-xs text-foreground/70">
                    <ShieldCheck className="h-3 w-3 shrink-0" />
                    {t("admin.approvedBy", { name: sanitizeDisplayText(series.representative.approved_by_name) })}
                  </span>
                )}
              </span>
            </span>
          </button>
          {!selectable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDeleteSeries}
              disabled={isActionBusy(`delete-series:${series.groupId}`)}
              className="w-full rounded-full sm:w-auto"
              aria-label={t("admin.deleteRecurringSeries")}
            >
              <Trash2 className="h-4 w-4" /> {t("admin.deleteSeries")}
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        // Indented rail so the occurrences read as nested *under* the series
        // header rather than as standalone bookings.
        <div className="px-3 pb-3 pl-6 sm:pl-8">
          <div className="space-y-2 border-l-2 border-border/70 pl-3 sm:pl-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {pageItems.map((booking) => (
                <OccurrenceCard
                  key={booking.id}
                  b={booking}
                  language={language}
                  onEdit={() => onEdit(booking)}
                  onDelete={() => onDeleteOccurrence(booking)}
                  deleteBusy={isActionBusy(`delete:${booking.id}`)}
                  selectable={selectable}
                  selected={selectedIds?.has(booking.id) ?? false}
                  onToggleSelect={() => onToggleSelect?.(booking.id)}
                />
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {pageStart + 1}–{pageStart + pageItems.length} / {series.occurrences.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPage(safePage - 1)}
                    disabled={safePage === 0}
                    aria-label={t("common.previous")}
                    className="h-9 w-9 rounded-full p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {safePage + 1}/{pageCount}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPage(safePage + 1)}
                    disabled={safePage >= pageCount - 1}
                    aria-label={t("common.next")}
                    className="h-9 w-9 rounded-full p-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

const getApprovedRows = (approved: Booking[], language = "en"): ApprovedRow[] => {
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
    const occurrences = [...rawOccurrences].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    );
    if (occurrences.length < 2) {
      rows.push({ kind: "single", booking: occurrences[0] });
      continue;
    }
    const first = occurrences[0];
    const last = occurrences[occurrences.length - 1];
    rows.push({
      kind: "series",
      groupId,
      title: first.title,
      name: first.name,
      occurrences,
      dateRangeLabel: `${fmtDate(first.start_time, language, true)} – ${fmtDate(last.start_time, language, true)}`,
      representative: first,
    });
  }

  return rows.sort((a, b) => {
    const aTime = new Date(a.kind === "single" ? a.booking.start_time : a.representative.start_time).getTime();
    const bTime = new Date(b.kind === "single" ? b.booking.start_time : b.representative.start_time).getTime();
    return aTime - bTime;
  });
};

const isApprovedRowPast = (row: ApprovedRow, now: number) => {
  if (row.kind === "single") return new Date(row.booking.end_time).getTime() < now;
  return row.occurrences.every((booking) => new Date(booking.end_time).getTime() < now);
};

const DAY_MS = 86_400_000;

const relativeExpiry = (expiresAt: string, t: (key: TranslationKey, vars?: Record<string, string | number>) => string) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    const days = Math.floor(-ms / DAY_MS);
    return days < 1 ? t("admin.invite.expiredToday") : t("admin.invite.expiredAgo", { days });
  }
  const days = Math.ceil(ms / DAY_MS);
  return days === 1 ? t("admin.invite.expiresInDay") : t("admin.invite.expiresInDays", { days });
};

const InviteRow = ({
  invite,
  language,
  onDeactivate,
}: {
  invite: AdminInvite;
  language: string;
  onDeactivate: () => void;
}) => {
  const { t } = useI18n();
  const isExpired = invite.expires_at ? new Date(invite.expires_at) <= new Date() : false;
  const isUsedUp = invite.used_count >= invite.max_uses;
  const status = !invite.active
    ? t("admin.invite.inactive")
    : isExpired
      ? t("admin.invite.expired")
      : isUsedUp
        ? t("admin.invite.used")
        : t("admin.invite.active");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {sanitizeDisplayText(invite.label) || t("admin.invite.defaultLabel")}
          </span>
          <span className="rounded-full border bg-background/60 px-2 py-0.5 type-badge">
            {status}
          </span>
        </div>
        <div className="mt-1 break-words text-xs text-muted-foreground">
          {t("admin.invite.usedCount", { used: invite.used_count, max: invite.max_uses })}
          {" · "}
          {invite.expires_at ? (
            // Codes are issued as a fixed lifetime, so read them back the same way —
            // "expires in 5 days", not a timestamp. The exact stamp is on hover.
            <span title={fmtDateTime(invite.expires_at, language, true)}>
              {relativeExpiry(invite.expires_at, t)}
            </span>
          ) : (
            t("admin.invite.noExpiry")
          )}
          {invite.last_used_at
            ? ` · ${t("admin.invite.lastUsedAt", { date: fmtDateTime(invite.last_used_at, language, true) })}`
            : ""}
        </div>
      </div>
      {invite.active && (
        <Button size="sm" variant="outline" onClick={onDeactivate} className="w-full rounded-full sm:w-auto">
          <Ban className="h-4 w-4" /> {t("admin.invite.deactivate")}
        </Button>
      )}
    </div>
  );
};

export default Admin;
