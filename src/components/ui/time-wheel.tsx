// ── TimeWheel ────────────────────────────────────────────────────────────────
// The iOS-style multi-column time wheel, extracted from TimeSelect so ONE
// implementation serves both hosts: the legacy inline panel (TimeSelect, still
// used by EventForm) and the Form System's PickerDropdown.
//
// Hour │ Minute (00/15/30/45) │ AM·PM in 12h; Hour │ Minute in 24h — the literal
// iOS UIDatePicker layout, so each wheel is a short flick instead of one 96-item
// spin. Each column is a real snapping wheel: scroll-snap locks a row under a fixed
// centre band (the "lock pin"), edge rows curve away (rotateX + fade), and the value
// commits when the flick settles.
//
// Round-trips "HH:mm", so nothing downstream changes. A same-day floor (minTime)
// greys past combinations and clamps the settled value up so a past start can never
// commit. Keyboard: each column is a listbox (↑/↓ change, Home/End, Esc handled by
// the host).
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { usePreferences } from "@/hooks/usePreferences";
import { useI18n } from "@/hooks/useI18n";
import { cn } from "@/lib/utils";

// When the browser fires `scrollend` (Chrome/Edge/Firefox, Safari 17.4+) we commit the
// wheel on that event — precise, never mid-fling. Older Safari has no such event, so it
// falls back to a debounced-scroll settle. Feature-detected once.
const SUPPORTS_SCROLLEND = typeof window !== "undefined" && "onscrollend" in window;

const pad2 = (n: number) => String(n).padStart(2, "0");
const MINUTES = [0, 15, 30, 45] as const;
// The latest slot within any hour — used to ask "is this whole hour/period past?".
const LAST_MINUTE = MINUTES[MINUTES.length - 1];

// Row geometry. VISIBLE_ROWS is odd so exactly one row sits under the centre band;
// the top & bottom spacers are half the viewport minus half a row, which makes the
// centring math exact: scrollTop = index * rowHeight centres row `index`, and
// index = round(scrollTop / rowHeight) reads it back.
const ROW_H = 40;
const COMPACT_ROW_H = 34;
const VISIBLE_ROWS = 5;
// Rows further than this from centre are visually pinned (min opacity, max
// rotation), so their per-frame values never change — clamp there and stop
// re-writing them.
const VISIBLE_SPAN = 3;

// ── HH:mm ↔ column tokens ────────────────────────────────────────────────────
const parseHm = (hm: string): { h: number; m: number } => {
  const [h, m] = hm.split(":").map(Number);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
};
const buildHm = (h24: number, m: number) => `${pad2(h24)}:${pad2(m)}`;
// 24h hour → { 12h hour 1–12, period }.
const to12 = (h24: number): { h12: number; period: "AM" | "PM" } => ({
  h12: h24 % 12 === 0 ? 12 : h24 % 12,
  period: h24 < 12 ? "AM" : "PM",
});
// { 12h hour, period } → 24h hour (12 AM → 0, 12 PM → 12).
const from12 = (h12: number, period: "AM" | "PM") => {
  const base = h12 % 12;
  return period === "PM" ? base + 12 : base;
};
// Nearest of the four 15-min slots to an arbitrary minute (defensive: values in are
// already aligned, but a legacy/off-grid minute snaps rather than falling off a wheel).
const nearestMinute = (m: number) =>
  MINUTES.reduce(
    (best, cur) => (Math.abs(cur - m) < Math.abs(best - m) ? cur : best),
    MINUTES[0],
  );

interface WheelOption {
  value: string;
  label: string;
  disabled: boolean;
}

// ── One snapping wheel column ─────────────────────────────────────────────────
function WheelColumn({
  options,
  value,
  onChange,
  ariaLabel,
  autoFocus,
  rowHeight,
}: {
  options: WheelOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  autoFocus?: boolean;
  rowHeight: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);
  const programmaticRef = useRef(false); // suppress settle while WE scroll
  const userScrollingRef = useRef(false); // don't fight a live flick with a re-centre
  const centreTimer = useRef<number | null>(null); // centreTo's guard-release backstop
  const reactId = useId();

  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  // Curvature: place each row on a cylinder by its distance (in rows) from the live
  // scroll centre — rotateX + fade. rAF-throttled, and deliberately frugal: this is
  // the heaviest per-frame main-thread work in the form, and it lands hardest on
  // older/low-power phones.
  //
  // Two economies, both applied on EVERY device rather than degrading a tier (the
  // motion doctrine is explicit that there are no degraded modes):
  //   • Only rows within VISIBLE_SPAN of centre are written. Beyond that a row is
  //     already pinned at min opacity / max rotation, so re-writing it each frame
  //     changes nothing visible. Cuts writes from ~24 to ~7.
  //   • Values are cached per row and skipped when unchanged, so a slow drag stops
  //     invalidating styles it isn't actually altering.
  const paint = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const centre = el.scrollTop + el.clientHeight / 2;
    el.querySelectorAll<HTMLElement>("[data-row]").forEach((row) => {
      const d = (row.offsetTop + row.offsetHeight / 2 - centre) / rowHeight;
      const ad = Math.abs(d);
      const clamped = Math.min(ad, VISIBLE_SPAN);
      // Past the span every row resolves to the same pinned values, so writing
      // them repeatedly is pure cost.
      const opacity = (Math.max(0.2, 1 - clamped * 0.26)).toFixed(3);
      const transform = `rotateX(${Math.max(-62, Math.min(62, -Math.sign(d) * clamped * 20)).toFixed(1)}deg) scale(${Math.max(0.84, 1 - clamped * 0.05).toFixed(3)})`;
      if (row.dataset.o !== opacity) {
        row.style.opacity = opacity;
        row.dataset.o = opacity;
      }
      if (row.dataset.t !== transform) {
        row.style.transform = transform;
        row.dataset.t = transform;
      }
    });
  }, [rowHeight]);

  const centreTo = useCallback(
    (idx: number, smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      programmaticRef.current = true;
      el.scrollTo({ top: idx * rowHeight, behavior: smooth ? "smooth" : "auto" });
      // Release the guard once the programmatic scroll finishes. `scrollend` releases it
      // precisely for a smooth scroll; this timer is the backstop (and the only signal
      // for an instant `auto` jump, which may not emit `scrollend`). Tracked so the
      // unmount cleanup can cancel it — the panel can close mid-centre.
      if (centreTimer.current != null) window.clearTimeout(centreTimer.current);
      centreTimer.current = window.setTimeout(
        () => {
          centreTimer.current = null;
          programmaticRef.current = false;
          paint();
        },
        smooth ? 320 : 0,
      );
    },
    [paint, rowHeight],
  );

  // Nearest selectable option to `from`, searching outward and preferring the later slot
  // (higher index) on a tie — so a landing in the disabled past resolves UP to the floor.
  const nearestEnabled = useCallback(
    (from: number) => {
      for (let d = 0; d < options.length; d++) {
        const down = from + d;
        if (down < options.length && !options[down].disabled) return down;
        const up = from - d;
        if (up >= 0 && !options[up].disabled) return up;
      }
      return from;
    },
    [options],
  );

  const settle = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    userScrollingRef.current = false;
    const raw = Math.max(
      0,
      Math.min(options.length - 1, Math.round(el.scrollTop / rowHeight)),
    );
    // Block landing on a disabled (past) row: snap to the nearest allowed one instead.
    const idx = options[raw]?.disabled ? nearestEnabled(raw) : raw;
    if (idx !== raw) {
      centreTo(idx, true); // smooth correction to the floor — the iOS "can't land there" feel
    } else if (Math.abs(el.scrollTop - idx * rowHeight) > 0.5) {
      el.scrollTop = idx * rowHeight; // micro-snap a hair off-grid
    }
    paint();
    const picked = options[idx];
    if (picked && picked.value !== value) onChange(picked.value);
  }, [options, value, onChange, paint, nearestEnabled, centreTo, rowHeight]);

  const onScroll = useCallback(() => {
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        paint();
      });
    }
    if (programmaticRef.current) return;
    userScrollingRef.current = true;
    // With `scrollend`, that event commits the value (never mid-fling). Without it, fall
    // back to a debounce that fires once scrolling has been quiet for 90ms.
    if (!SUPPORTS_SCROLLEND) {
      if (settleRef.current) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(settle, 90);
    }
  }, [paint, settle]);

  // Primary commit path where supported: fires once, after momentum fully stops.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !SUPPORTS_SCROLLEND) return;
    const onScrollEnd = () => {
      if (programmaticRef.current) {
        programmaticRef.current = false; // our own centring finished; don't treat as a pick
        paint();
        return;
      }
      settle();
    };
    el.addEventListener("scrollend", onScrollEnd);
    return () => el.removeEventListener("scrollend", onScrollEnd);
  }, [settle, paint]);

  // Centre on mount (no animation), before the first paint so nothing flashes off-centre.
  // The first column also grabs focus so keyboard users land inside the wheel on open
  // (preventScroll so it doesn't fight the centring or yank the page).
  useLayoutEffect(() => {
    centreTo(index, false);
    paint();
    if (autoFocus) scrollRef.current?.focus({ preventScroll: true });
    // Mount-only: subsequent value syncs are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-centre when the value changes from OUTSIDE (parent clamp, sibling-column edit,
  // keyboard) — but never mid-flick, or we'd yank the wheel out from under the user.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrollingRef.current) return;
    if (Math.round(el.scrollTop / rowHeight) !== index) centreTo(index, true);
    else paint();
  }, [index, centreTo, paint, rowHeight]);

  // Cancel any pending frame/timer on unmount (panel close).
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (settleRef.current != null) window.clearTimeout(settleRef.current);
      if (centreTimer.current != null) window.clearTimeout(centreTimer.current);
    },
    [],
  );

  // Step to the next SELECTABLE option in the direction of travel, skipping greyed ones
  // entirely — so a stepper/arrow key can't land on a past slot and lean on commit()'s
  // clamp to undo it. Stays put when there's nothing selectable that way.
  const move = (delta: number) => {
    const dir = delta > 0 ? 1 : -1;
    for (let i = index + dir; i >= 0 && i < options.length; i += dir) {
      if (!options[i].disabled) {
        onChange(options[i].value);
        return;
      }
    }
  };

  const firstEnabled = options.findIndex((o) => !o.disabled);
  const lastEnabled =
    options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled);
  const canStepUp = firstEnabled !== -1 && index > firstEnabled;
  const canStepDown = firstEnabled !== -1 && index < lastEnabled;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "Home") {
      e.preventDefault();
      if (firstEnabled !== -1 && index !== firstEnabled)
        onChange(options[firstEnabled].value);
    } else if (e.key === "End") {
      e.preventDefault();
      if (firstEnabled !== -1 && index !== lastEnabled)
        onChange(options[lastEnabled].value);
    }
    // Escape is handled by the host (inline panel or picker screen).
  };

  const activeId = `${reactId}-${index}`;

  // Mouse-only affordance: a subtle ▲/▼ that fades in when the pointer is over THIS
  // column, so a desktop user can see the wheel is steppable instead of guessing. Click
  // only — deliberately no hover handler, so hovering never scrolls anything. Hidden from
  // assistive tech (tabIndex -1 + aria-hidden): it duplicates the arrow keys the listbox
  // already exposes, and reuses the exact same `move` path.
  const stepButtonClass = (dir: "up" | "down") =>
    cn(
      "absolute inset-x-0 z-20 mx-auto hidden h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity duration-fast",
      "text-muted-foreground/70 hover:text-foreground disabled:text-muted-foreground/25",
      "group-hover:opacity-100",
      // Underscores become spaces: `@media (hover:hover) and (pointer:fine)`. Without them
      // Tailwind emits `@media(hover:hover)and(...)`, which is invalid CSS and fails the build.
      "[@media(hover:hover)_and_(pointer:fine)]:flex",
      dir === "up" ? "top-0" : "bottom-0",
    );

  return (
    <div className="group relative min-w-0 flex-1">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        disabled={!canStepUp}
        onClick={() => move(-1)}
        className={stepButtonClass("up")}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>

      <div
        ref={scrollRef}
        role="listbox"
        aria-label={ariaLabel}
        aria-activedescendant={activeId}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{
          height: rowHeight * VISIBLE_ROWS,
          perspective: "760px",
          scrollSnapType: "y mandatory",
          // Fade the top & bottom edges regardless of panel background.
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent)",
          maskImage:
            "linear-gradient(to bottom, transparent, #000 26%, #000 74%, transparent)",
        }}
        className="relative w-full touch-pan-y overflow-y-scroll overscroll-contain outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:bg-foreground/[0.03] [&::-webkit-scrollbar]:hidden"
      >
        <div aria-hidden style={{ height: (rowHeight * (VISIBLE_ROWS - 1)) / 2 }} />
        {options.map((o, i) => {
          const selected = i === index;
          return (
            <div
              key={o.value}
              id={`${reactId}-${i}`}
              role="option"
              aria-selected={selected}
              aria-disabled={o.disabled || undefined}
              data-row
              onClick={() => {
                if (!o.disabled && o.value !== value) onChange(o.value);
              }}
              style={{
                height: rowHeight,
                scrollSnapAlign: "center",
                transformOrigin: "center",
              }}
              className={cn(
                "flex cursor-pointer select-none items-center justify-center tabular-nums transition-colors duration-fast",
                rowHeight < ROW_H ? "text-base" : "text-lg",
                selected
                  ? "font-semibold text-foreground"
                  : o.disabled
                    ? "cursor-default text-muted-foreground/40"
                    : // Hover feedback so a mouse user can see rows are clickable — they had
                      // cursor-pointer but no visual response at all.
                      "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </div>
          );
        })}
        <div aria-hidden style={{ height: (rowHeight * (VISIBLE_ROWS - 1)) / 2 }} />
      </div>

      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        disabled={!canStepDown}
        onClick={() => move(1)}
        className={stepButtonClass("down")}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export interface TimeWheelProps {
  value: string; // "HH:mm"
  onChange: (value: string) => void;
  /** Combinations before this "HH:mm" are disabled (same-day floor); omit for none. */
  minTime?: string;
  /**
   * "compact" matches the calendar dropdown's density (36px cells) so the two
   * pickers read as the same size when opened from adjacent fields.
   */
  size?: "default" | "compact";
  className?: string;
}

/**
 * The wheel itself — columns + the lock pin. Hosts supply their own chrome
 * (inline panel border, or a picker screen's footer with Done).
 */
export function TimeWheel({ value, onChange, minTime, size = "default", className }: TimeWheelProps) {
  const { timeFormat } = usePreferences();
  const { t } = useI18n();
  const hour12 = timeFormat === "12h";
  const rowHeight = size === "compact" ? COMPACT_ROW_H : ROW_H;

  const { h: h24, m: rawM } = parseHm(value);
  const m = nearestMinute(rawM);
  const { h12, period } = to12(h24);

  // Current column tokens.
  const hourToken = hour12 ? String(h12) : pad2(h24);
  const minuteToken = pad2(m);
  const periodToken = period;

  const isPast = useCallback(
    (candidate: string) => !!minTime && candidate < minTime,
    [minTime],
  );

  // Column option lists. A row is greyed only when that unit is ENTIRELY past — i.e. even
  // its latest minute is before the floor — never merely "past given where the other
  // wheels happen to sit". Judging an hour by the currently-selected minute greyed out
  // reachable times (floor 17:30 + minute 00 wrongly greyed the whole 17 hour, putting
  // 17:30 out of reach) and made the greys shift as you spun a different column. Sub-hour
  // cases are handled by commit()'s clamp instead, which nudges 17:00 up to 17:30.
  const hourOptions = useMemo<WheelOption[]>(() => {
    const src = hour12
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : Array.from({ length: 24 }, (_, i) => i);
    return src.map((hv) => {
      const h24v = hour12 ? from12(hv, periodToken) : hv;
      return {
        value: hour12 ? String(hv) : pad2(hv),
        label: hour12 ? String(hv) : pad2(hv),
        disabled: isPast(buildHm(h24v, LAST_MINUTE)),
      };
    });
  }, [hour12, periodToken, isPast]);

  // Minutes ARE judged against the chosen hour — inside the floor's own hour, the
  // earlier minutes are genuinely unreachable (17:00/17:15 under a 17:30 floor).
  const minuteOptions = useMemo<WheelOption[]>(
    () =>
      MINUTES.map((mv) => ({
        value: pad2(mv),
        label: pad2(mv),
        disabled: isPast(buildHm(h24, mv)),
      })),
    [h24, isPast],
  );

  // A period is past only once its final slot (11:45 / 23:45) is behind the floor.
  const periodOptions = useMemo<WheelOption[]>(
    () =>
      (["AM", "PM"] as const).map((pv) => ({
        value: pv,
        label: pv,
        disabled: isPast(buildHm(pv === "AM" ? 11 : 23, LAST_MINUTE)),
      })),
    [isPast],
  );

  // Recombine after any column settles, clamp up to the floor, and emit "HH:mm".
  const commit = useCallback(
    (next: { hour?: string; minute?: string; period?: "AM" | "PM" }) => {
      const hTok = next.hour ?? hourToken;
      const mTok = next.minute ?? minuteToken;
      const pTok = next.period ?? periodToken;
      const nextH24 = hour12 ? from12(Number(hTok), pTok) : Number(hTok);
      let hm = buildHm(nextH24, Number(mTok));
      if (minTime && hm < minTime) hm = minTime; // never commit a past combination
      if (hm !== value) onChange(hm);
    },
    [hour12, hourToken, minuteToken, periodToken, minTime, value, onChange],
  );

  return (
    <div
      className={cn("relative flex items-stretch gap-1", className)}
      role="group"
      aria-label={t("bookingForm.time")}
    >
      {/* The lock pin: one continuous centre band across every column. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 rounded-lg bg-foreground/[0.05] ring-1 ring-inset ring-border"
        style={{ height: rowHeight }}
      />
      <WheelColumn
        options={hourOptions}
        value={hourToken}
        onChange={(v) => commit({ hour: v })}
        ariaLabel={t("bookingForm.wheelHour")}
        rowHeight={rowHeight}
        autoFocus
      />
      <WheelColumn
        options={minuteOptions}
        value={minuteToken}
        onChange={(v) => commit({ minute: v })}
        ariaLabel={t("bookingForm.wheelMinute")}
        rowHeight={rowHeight}
      />
      {hour12 && (
        <WheelColumn
          options={periodOptions}
          value={periodToken}
          onChange={(v) => commit({ period: v as "AM" | "PM" })}
          ariaLabel={t("bookingForm.wheelPeriod")}
          rowHeight={rowHeight}
        />
      )}
    </div>
  );
}

export default TimeWheel;
