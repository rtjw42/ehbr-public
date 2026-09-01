// ── Landing (/) ──────────────────────────────────────────────────────────────
// Home page: today's sessions, the next upcoming gig, and the About card (contacts).
// Subscribes to realtime for bookings and contacts so the snapshot stays current;
// the initial load batches bookings + events + contacts in one pass.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Camera, ChevronRight, Speaker } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EventItem } from "@/lib/events";
import { Booking } from "@/lib/booking-utils";
import { format, isPast } from "date-fns";
import { toast } from "sonner";
import { sanitizeDisplayText } from "@/lib/sanitize";
import { loadTodayApprovedBookings } from "@/services/bookings";
import { loadEvents } from "@/services/events";
import { loadContacts, type ContactWithFields, type ContactFieldType } from "@/services/contacts";
import { linkedContactTypes } from "@/lib/contact-fields";
import { ContactLinks } from "@/components/ContactLinks";
import { FadeInImg } from "@/components/FadeInImg";
import { useI18n } from "@/hooks/useI18n";
import { formatDateAtTime, formatLocalizedDate, getDateLocale } from "@/lib/date";
import bookRoomBg from "@/assets/book-room.jpeg";
import bookRoomBgWebp from "@/assets/book-room.webp";
import bookRoomBgAvif from "@/assets/book-room.avif";
import aboutCardBg from "@/assets/about-card.jpeg";
import aboutCardBgWebp from "@/assets/about-card.webp";
import aboutCardBgAvif from "@/assets/about-card.avif";
import eventsCardBg from "@/assets/landing-events.jpeg";
import eventsCardBgWebp from "@/assets/landing-events.webp";
import eventsCardBgAvif from "@/assets/landing-events.avif";

const SkeletonBlock = ({ className }: { className: string }) => (
  <div className={`skeleton-block ${className}`} aria-hidden="true" />
);

const Landing = () => {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [todayBookings, setTodayBookings] = useState<Booking[]>([]);
  const [contacts, setContacts] = useState<ContactWithFields[]>([]);
  const [initialLoadSettled, setInitialLoadSettled] = useState(false);
  const { language, t } = useI18n();
  const dateLocale = getDateLocale(language);
  const today = new Date();
  const todayDateLabel = language === "zh"
    ? formatLocalizedDate(today, language, "EEE d MMM", "M 月 d 日 EEEE")
    : format(today, "EEE d MMM", { locale: dateLocale });
  const mountedRef = useRef(true);

  const loadTodayBookings = useCallback(async () => {
    try {
      setTodayBookings(await loadTodayApprovedBookings());
    } catch (error: unknown) {
      toast.error(error instanceof TypeError ? t("common.networkIssue") : t("landing.todayBookingsLoadFailed"));
    }
  }, [t]);

  const loadLandingEvents = useCallback(async () => {
    try {
      setEvents(await loadEvents());
    } catch {
      // Keep the public landing page quiet on transient load failures.
    }
  }, []);

  const loadLandingContacts = useCallback(async () => {
    try {
      setContacts(await loadContacts());
    } catch {
      // Keep the public landing page quiet on transient load failures.
    }
  }, []);

  useEffect(() => {
    if (!initialLoadSettled) return;
    const ch = supabase
      .channel("landing-public")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: "status=eq.approved" }, () => loadTodayBookings())
      .on("postgres_changes", { event: "*", schema: "public", table: "site_contacts" }, () => loadLandingContacts())
      .on("postgres_changes", { event: "*", schema: "public", table: "site_contact_fields" }, () => loadLandingContacts())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [initialLoadSettled, loadTodayBookings, loadLandingContacts]);

  const nextGig = useMemo(
    () => events.find((event) => !isPast(new Date(event.end_date ?? event.event_date))),
    [events],
  );

  const socialLinks = useMemo(() => {
    const contact = contacts.find((c) => c.active !== false) ?? null;
    return (contact?.site_contact_fields ?? [])
      .filter((f) => linkedContactTypes.has(f.field_type as ContactFieldType));
  }, [contacts]);

  useEffect(() => {
    if (!initialLoadSettled) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void Promise.allSettled([loadTodayBookings(), loadLandingEvents(), loadLandingContacts()]);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [initialLoadSettled, loadLandingEvents, loadTodayBookings, loadLandingContacts]);

  useEffect(() => {
    mountedRef.current = true;
    const runInitialLoad = async () => {
      const [bookingResult, eventResult, contactResult] = await Promise.allSettled([
        loadTodayApprovedBookings(),
        loadEvents(),
        loadContacts(),
      ]);
      if (!mountedRef.current) return;
      if (bookingResult.status === "fulfilled") setTodayBookings(bookingResult.value);
      if (eventResult.status === "fulfilled") setEvents(eventResult.value);
      if (contactResult.status === "fulfilled") setContacts(contactResult.value);
      setInitialLoadSettled(true);
    };
    void runInitialLoad();
    return () => { mountedRef.current = false; };
  }, []);

  // Future-proof: add a page here and it drops into the About card's tile grid.
  // `to: null` renders a disabled "coming soon" tile (no route yet).
  const otherPages: { key: string; to: string | null; icon: typeof Speaker; label: string; comingSoon: boolean }[] = [
    { key: "backline", to: "/backline", icon: Speaker, label: t("landing.about.backlineRates"), comingSoon: false },
    { key: "photos", to: "/media", icon: Camera, label: t("landing.about.photos"), comingSoon: false },
  ];

  return (
    <div className="min-h-svh flex-1 text-foreground">
      <main>
        {/* ── Hero ── */}
        <section className="overflow-guard relative min-h-svh overflow-hidden border-b border-primary/15">
          {/* Subtle grain */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 opacity-[0.18] dark:opacity-[0.10]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 18% 22%, rgba(26,26,26,0.12) 0 1px, transparent 1px 3px), radial-gradient(circle at 78% 64%, rgba(26,26,26,0.08) 0 1px, transparent 1px 4px), linear-gradient(120deg, rgba(255,255,255,0.35), transparent 42%, rgba(0,0,0,0.05))",
            }}
          />
          <div className="relative z-10 mx-auto flex min-h-svh w-full max-w-7xl flex-col justify-center gap-8 px-4 py-[clamp(5.5rem,12vh,7rem)] sm:px-6">
            {/* Heading */}
            <div className="min-w-0 pt-4 sm:pt-8">
              <h1 className="type-hero m-0 max-w-[10ch] text-wrap text-[hsl(20_28%_8%)] dark:text-foreground">
                Eusoff Bandits
              </h1>
            </div>

            {/* ── Card grid ── */}
            <div className="grid gap-5 lg:grid-cols-2">

              {/* Book the Room card — full-bleed photo, content pinned to bottom */}
              <Link
                to="/bookings"
                className="group relative overflow-hidden rounded-lg shadow-md transition-transform duration-base active:scale-[0.99]"
              >
                <picture className="contents">
                  <source srcSet={bookRoomBgAvif} type="image/avif" />
                  <source srcSet={bookRoomBgWebp} type="image/webp" />
                  <FadeInImg
                    src={bookRoomBg}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover object-center"
                    loading="eager"
                  />
                </picture>
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/25" />
                <div className="relative z-10 flex min-h-[18rem] flex-col justify-between p-7 sm:min-h-[20rem]">
                  <div className="flex items-start justify-between gap-4">
                    <span className="type-card-title-lg text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.5)]">
                      {t("landing.bookRoom")}
                    </span>                  </div>
                  <div className="flex items-end justify-between gap-4">
                    {/* Standardized info pill — both landing cards share this fixed
                        width so neither resizes with content (see Events card below). */}
                    <div className="w-full min-w-0 max-w-[16rem] rounded-xl border border-white/15 bg-black/35 px-3.5 py-2.5 frost-box">
                      <p className="type-eyebrow text-white/50">
                        {t("landing.happeningToday")} <span aria-hidden="true">//</span> {todayDateLabel}
                      </p>
                      {!initialLoadSettled ? (
                        <SkeletonBlock className="mt-1.5 h-4 w-24 rounded-full" />
                      ) : (
                        <p className="mb-0 mt-1 text-sm font-semibold normal-case text-white/85">
                          {todayBookings.length === 0
                            ? t("landing.noSessionsToday")
                            : todayBookings.length === 1
                            ? t("landing.sessionSingular")
                            : t("landing.sessionsCount", { count: todayBookings.length })}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-9 w-9 shrink-0 text-white/70 transition-transform duration-base group-hover:translate-x-1 group-active:translate-x-1" aria-hidden="true" />
                  </div>
                </div>
              </Link>

              {/* Events card — full-bleed poster (or fallback), content pinned to bottom */}
              <Link
                to="/events"
                className="group relative overflow-hidden rounded-lg shadow-md transition-transform duration-base active:scale-[0.99]"
              >
                {/* Fixed editorial photo — the card no longer borrows the next gig's
                    poster, so its look stays stable regardless of what's scheduled. */}
                <picture className="contents">
                  <source srcSet={eventsCardBgAvif} type="image/avif" />
                  <source srcSet={eventsCardBgWebp} type="image/webp" />
                  <FadeInImg
                    src={eventsCardBg}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover object-center"
                    loading="lazy"
                  />
                </picture>
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/25" />
                <div className="relative z-10 flex min-h-[18rem] flex-col justify-between p-7 sm:min-h-[20rem]">
                  <div className="flex items-start justify-between gap-4">
                    <span className="type-card-title-lg text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.5)]">
                      {t("landing.events")}
                    </span>                  </div>
                  <div className="flex items-end justify-between gap-4">
                    {/* Same standardized pill as the Book-the-Room card — fixed width,
                        so a long gig title truncates (…) instead of widening the pill. */}
                    <div className="w-full min-w-0 max-w-[16rem] rounded-xl border border-white/15 bg-black/35 px-3.5 py-2.5 frost-box">
                      {!initialLoadSettled ? (
                        <div className="space-y-2">
                          <SkeletonBlock className="h-5 w-48 max-w-full rounded-full" />
                          <SkeletonBlock className="h-4 w-24 rounded-full" />
                        </div>
                      ) : (
                        <>
                          {/* Single line + ellipsis so the pill keeps one fixed footprint
                              regardless of the gig title length (no resize between events). */}
                          <p className="mb-0 truncate text-base font-semibold normal-case text-white/85">
                            {nextGig ? sanitizeDisplayText(nextGig.title) : t("landing.noEvent")}
                          </p>
                          {nextGig && (
                            <p className="mb-0 mt-2 text-xs font-semibold tabular-nums text-white/50">
                              {formatDateAtTime(new Date(nextGig.event_date), language, "MMM d", "M 月 d 日")}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    <ChevronRight className="h-9 w-9 shrink-0 text-white/70 transition-transform duration-base group-hover:translate-x-1 group-active:translate-x-1" aria-hidden="true" />
                  </div>
                </div>
              </Link>
            </div>

            {/* ── About / Services card ── */}
            <div>
              <div className="relative overflow-hidden rounded-lg shadow-md">
                {/* Full-bleed photo, kept prominent — gradient only darkens enough
                    at the bottom to keep the overlaid content legible. */}
                <picture className="contents">
                  <source srcSet={aboutCardBgAvif} type="image/avif" />
                  <source srcSet={aboutCardBgWebp} type="image/webp" />
                  <FadeInImg
                    src={aboutCardBg}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover object-[center_30%]"
                    loading="lazy"
                  />
                </picture>
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black/75" />
                {/* A touch of uniform overlay for depth (the other cards lean on a
                    heavier gradient; this nudges About a bit closer). */}
                <div className="absolute inset-0 bg-black/15" />

                {/* About Us + intro pinned to the top, Other-pages tiles pinned to the
                    bottom, photo breathing in between. Gradient darkens both ends. */}
                <div className="relative z-10 flex min-h-[28rem] flex-col justify-between gap-6 p-7 sm:min-h-[32rem]">
                  {/* Top: heading + intro + socials */}
                  <div className="space-y-4">
                    <h2 className="type-card-title-lg text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.5)]">
                      {t("landing.about.heading")}
                    </h2>

                    {/* Intro + socials directly on the photo — text-shadow carries the
                        legibility instead of a panel. Socials mirror the site footer. */}
                    <div className="max-w-sm [text-shadow:0_1px_12px_rgba(0,0,0,0.65)]">
                      <p className="mb-0 text-sm font-semibold leading-relaxed text-white/85 sm:text-base">
                        {t("landing.about.description")}
                      </p>
                      <p className="mb-0 mt-0.5 text-sm font-semibold leading-relaxed text-white/85 sm:text-base">
                        {t("landing.about.contact")}
                      </p>
                      {socialLinks.length > 0 && (
                        <div className="mt-2 flex items-center gap-1 drop-shadow-[0_1px_6px_rgba(0,0,0,0.55)]">
                          <ContactLinks
                            fields={socialLinks}
                            iconClassName="inline-flex h-6 w-6 items-center justify-center text-white transition-opacity duration-base hover:opacity-60"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Other pages — extensible tile grid (add entries in `otherPages`) */}
                  <div>
                    <p className="type-eyebrow mb-2 text-white/50">
                      {t("landing.about.otherPages")}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {otherPages.map((page) => {
                        const Icon = page.icon;
                        const body = (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20 text-white">
                                <Icon className="h-5 w-5" aria-hidden="true" />
                              </span>
                              {page.comingSoon ? (
                                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-white/75">
                                  {t("landing.about.comingSoon")}
                                </span>
                              ) : (
                                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-white/70 transition-transform duration-base group-hover/tile:translate-x-0.5" aria-hidden="true" />
                              )}
                            </div>
                            <span className="mt-4 block text-sm font-semibold leading-snug text-white sm:text-base">
                              {page.label}
                            </span>
                          </>
                        );
                        const base = "group/tile flex min-h-[6.75rem] flex-col justify-between rounded-xl border border-white/15 bg-black/35 p-3.5 frost-box";
                        return page.to ? (
                          <Link
                            key={page.key}
                            to={page.to}
                            className={`${base} transition-colors duration-base hover:border-white/30 hover:bg-black/45 active:bg-black/45`}
                          >
                            {body}
                          </Link>
                        ) : (
                          // Dim the content, not the panel — element opacity on a
                          // backdrop-filtered box ghosts the blur (the unblurred photo
                          // bleeds through the translucency).
                          <div key={page.key} aria-disabled="true" className={base}>
                            <div className="flex h-full w-full flex-1 flex-col justify-between opacity-60">
                              {body}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>
      </main>
    </div>
  );
};

export default Landing;
