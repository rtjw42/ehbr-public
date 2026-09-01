// ── Consent gate ─────────────────────────────────────────────────────────────
// First-run gate shown before the app: language choice, then legal acceptance. The
// app's children only mount once consent is given (so no analytics/Sentry can run
// pre-consent), and accepting triggers Sentry init. Acceptance is remembered in
// localStorage, falling back to in-memory if storage is blocked.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ChevronRight, Clock, Languages, Sun } from "lucide-react";
import { initSentryAfterConsent } from "@/lib/sentry";
import { consentEntrance, splashCtaEntrance, splashLogoEntrance } from "@/lib/motion";
import { getLegalContent } from "@/lib/legal";
import { LegalCopyRenderer } from "@/components/LegalCopyRenderer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { usePreferences } from "@/hooks/usePreferences";
import { useI18n } from "@/hooks/useI18n";
import { useScrollLock } from "@/hooks/useScrollLock";
import { cn } from "@/lib/utils";
import type {
  LanguagePreference,
  ThemePreference,
  TimeFormatPreference,
} from "@/contexts/preferences-context";

const CONSENT_KEY = "eb:consent:v1";
const SCROLL_THRESHOLD = 12;
let inMemoryConsentAccepted = false;

const hasConsent = () => {
  if (inMemoryConsentAccepted) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
};

export const ConsentGate = ({ children }: { children: ReactNode }) => {
  const [accepted, setAccepted] = useState(() => hasConsent());
  // The app mounts only once the gate has fully faded out (onExitComplete) — the gate
  // is transparent (the textured canvas shows through), so mounting the app underneath
  // it mid-fade would let the page peek around the panel. Returning visitors (already
  // accepted) skip the gate entirely and render the app immediately.
  const [showApp, setShowApp] = useState(() => hasConsent());
  const [step, setStep] = useState<"splash" | "language" | "legal">("splash");
  const [legalRead, setLegalRead] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme, language, setLanguage, timeFormat, setTimeFormat } = usePreferences();
  const { t } = useI18n();
  const legalContent = getLegalContent(language);

  useEffect(() => {
    if (accepted) initSentryAfterConsent();
  }, [accepted]);

  // Safety net: the app mounts on the gate's exit-complete callback, but an animation
  // completion signal can be lost (interrupted paint, reduced motion). Never leave the
  // app unmounted — force it in shortly after accept regardless. Idempotent with
  // onExitComplete; the exit (0.35s) normally wins the race.
  useEffect(() => {
    if (!accepted) return;
    const id = window.setTimeout(() => setShowApp(true), 600);
    return () => window.clearTimeout(id);
  }, [accepted]);

  useScrollLock(!accepted);

  const syncReadState = useCallback(() => {
    const node = contentRef.current;
    if (!node) return;
    const atEnd =
      node.scrollHeight <= node.clientHeight + SCROLL_THRESHOLD ||
      node.scrollTop + node.clientHeight >= node.scrollHeight - SCROLL_THRESHOLD;
    setLegalRead(atEnd);
  }, []);

  useEffect(() => {
    if (accepted || step !== "legal") return;
    setLegalRead(false);

    let secondFrame: number | undefined;
    const firstFrame = window.requestAnimationFrame(() => {
      if (contentRef.current) contentRef.current.scrollTop = 0;
      syncReadState();
      secondFrame = window.requestAnimationFrame(syncReadState);
    });
    const resizeObserver =
      typeof ResizeObserver !== "undefined" && contentRef.current
        ? new ResizeObserver(syncReadState)
        : null;
    if (contentRef.current) resizeObserver?.observe(contentRef.current);
    window.addEventListener("resize", syncReadState);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncReadState);
    };
  }, [accepted, step, syncReadState]);

  const agree = () => {
    if (!legalRead) return;
    inMemoryConsentAccepted = true;
    try {
      window.localStorage.setItem(CONSENT_KEY, "accepted");
    } catch {
      // Keep consent in-memory only if storage is blocked.
    }
    setAccepted(true);
  };

  const selectLanguage = (next: LanguagePreference) => setLanguage(next);

  return (
    <>
      {showApp && children}

      {/* On accept, the whole gate fades out over the textured canvas; only when that
          exit completes does the app mount (see showApp) and play its own page-enter —
          a clean "setup dissolves → app arrives" hand-off. */}
      <AnimatePresence onExitComplete={() => setShowApp(true)}>
        {!accepted && (
          <motion.div
            key="consent-gate"
            className="consent-gate"
            exit={{ opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } }}
          >
            {/* The textured backdrop is the root canvas (html), which shows through behind
                this transparent gate — no separate background layer needed here any more. */}

            <AnimatePresence mode="wait">
        {step === "splash" ? (
          // Step 0 — a chromeless splash on the bare textured canvas (no card): just
          // the logo settling in, then a quiet `pref setup ›` affordance. The whole
          // surface advances; the button carries the a11y. Makes the one-time setup
          // feel intentional.
          <motion.div
            key="splash"
            className="consent-splash"
            role="button"
            tabIndex={0}
            onClick={() => setStep("language")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setStep("language");
              }
            }}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <motion.img
              src="/icon-512.png"
              alt="Eusoff Bandits"
              className="consent-splash-logo"
              variants={splashLogoEntrance}
              draggable={false}
            />
            <motion.span
              className="inline-flex items-center gap-1.5 text-sm font-medium tracking-wide text-muted-foreground"
              variants={splashCtaEntrance}
            >
              {t("consent.splashCta")}
              <motion.span
                className="inline-flex"
                aria-hidden
                animate={{ x: [0, 3, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <ChevronRight className="h-4 w-4" />
              </motion.span>
            </motion.span>
          </motion.div>
        ) : (
          <motion.section
            key={step}
            className={cn("consent-panel", step === "language" && "is-compact")}
            role="dialog"
            aria-modal="true"
            aria-labelledby={step === "language" ? "consent-lang-title" : "consent-legal-title"}
            variants={consentEntrance}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <div className="consent-body">
              {step === "language" ? (
                // Language + first-run preferences on one page. Scrolls (not vertically
                // centred) so the groups + the note never clip on a short screen. Each
                // choice is the app's own SegmentedControl — compact, on-theme.
                <div className="flex h-full flex-col gap-5 overflow-y-auto pr-0.5" aria-labelledby="consent-lang-title">
                  <h1 id="consent-lang-title" className="type-dialog-title">
                    {t("consent.preferencesTitle")}
                  </h1>

                  <section className="space-y-2" aria-labelledby="cg-language">
                    <div id="cg-language" className="flex items-center gap-2 text-[0.76rem] font-semibold text-muted-foreground">
                      <Languages className="h-3.5 w-3.5" aria-hidden /> {t("preferences.language")}
                    </div>
                    <SegmentedControl<LanguagePreference>
                      ariaLabelledBy="cg-language"
                      value={language}
                      onChange={selectLanguage}
                      options={[
                        { value: "en", label: t("language.english") },
                        { value: "zh", label: t("language.chinese") },
                      ]}
                    />
                  </section>

                  <section className="space-y-2" aria-labelledby="cg-appearance">
                    <div id="cg-appearance" className="flex items-center gap-2 text-[0.76rem] font-semibold text-muted-foreground">
                      <Sun className="h-3.5 w-3.5" aria-hidden /> {t("consent.appearance")}
                    </div>
                    <SegmentedControl<ThemePreference>
                      ariaLabelledBy="cg-appearance"
                      value={theme}
                      onChange={setTheme}
                      options={[
                        { value: "light", label: t("preferences.light") },
                        { value: "dark", label: t("preferences.dark") },
                      ]}
                    />
                  </section>

                  <section className="space-y-2" aria-labelledby="cg-time">
                    <div id="cg-time" className="flex items-center gap-2 text-[0.76rem] font-semibold text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden /> {t("consent.timeFormat")}
                    </div>
                    <SegmentedControl<TimeFormatPreference>
                      ariaLabelledBy="cg-time"
                      value={timeFormat}
                      onChange={setTimeFormat}
                      options={[
                        { value: "24h", label: t("preferences.time24") },
                        { value: "12h", label: t("preferences.time12") },
                      ]}
                    />
                  </section>

                  <p className="text-xs text-muted-foreground">{t("consent.changeLater")}</p>
                </div>
              ) : (
                <div
                  ref={contentRef}
                  onScroll={syncReadState}
                  className="consent-copy"
                  tabIndex={0}
                  id="consent-legal-title"
                  aria-label="Privacy Policy and Terms of Use"
                >
                  <LegalCopyRenderer copy={legalContent.privacy} />
                  <div className="my-6 border-t border-border/50" />
                  <LegalCopyRenderer copy={legalContent.terms} />
                </div>
              )}
            </div>

            <div className="consent-actions">
              <div className="consent-action-row">
                {step === "language" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setStep("splash")}
                      className="consent-back-button"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {t("common.back")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("legal")}
                      className="consent-arrow-button is-ready"
                      aria-label="Continue to policies"
                    >
                      <ArrowRight className="h-5 w-5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setStep("language")}
                      className="consent-back-button"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      {t("common.back")}
                    </button>
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-muted-foreground">
                        {legalRead ? t("consent.readyEnter") : t("consent.scroll")}
                      </p>
                      <button
                        type="button"
                        onClick={agree}
                        disabled={!legalRead}
                        className={`consent-agree-button ${legalRead ? "is-ready" : ""}`}
                      >
                        {t("consent.agree")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.section>
        )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
