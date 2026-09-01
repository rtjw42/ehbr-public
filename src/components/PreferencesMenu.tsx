import { Clock, Download, Languages, Share, SlidersHorizontal, Sun } from "lucide-react";
import { usePreferences } from "@/hooks/usePreferences";
import { useI18n } from "@/hooks/useI18n";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { LanguagePreference, ThemePreference, TimeFormatPreference } from "@/contexts/preferences-context";

const sectionLabelClass = "flex min-h-4 items-center gap-2 text-[0.76rem] font-semibold leading-normal text-muted-foreground";

export const PreferencesMenuPanel = ({ className }: { className?: string }) => {
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    timeFormat,
    setTimeFormat,
  } = usePreferences();
  const { t } = useI18n();
  const { canPromptInstall, showIosHint, promptInstall } = useInstallPrompt();

  return (
    <div className={cn("space-y-5 p-4", className)}>
      <div className="flex items-center gap-2 text-foreground">
        <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="type-dialog-title">{t("preferences.title")}</p>
      </div>

      <section className="space-y-2" aria-labelledby="theme-preference">
        <div className={sectionLabelClass}>
          <Sun className="h-3.5 w-3.5" aria-hidden="true" />
          <span id="theme-preference">{t("preferences.mode")}</span>
        </div>
        <SegmentedControl<ThemePreference>
          ariaLabelledBy="theme-preference"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: t("preferences.light") },
            { value: "dark", label: t("preferences.dark") },
          ]}
        />
      </section>

      <section className="space-y-2" aria-labelledby="language-preference">
        <div className={sectionLabelClass}>
          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
          <span id="language-preference">{t("preferences.language")}</span>
        </div>
        <SegmentedControl<LanguagePreference>
          ariaLabelledBy="language-preference"
          value={language}
          onChange={setLanguage}
          options={[
            { value: "en", label: t("language.english") },
            { value: "zh", label: t("language.chinese") },
          ]}
        />
      </section>

      <section className="space-y-2" aria-labelledby="time-preference">
        <div className={sectionLabelClass}>
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span id="time-preference">{t("preferences.time")}</span>
        </div>
        <SegmentedControl<TimeFormatPreference>
          ariaLabelledBy="time-preference"
          value={timeFormat}
          onChange={setTimeFormat}
          options={[
            { value: "24h", label: t("preferences.time24") },
            { value: "12h", label: t("preferences.time12") },
          ]}
        />
      </section>

      {(canPromptInstall || showIosHint) && (
        <section className="space-y-2" aria-labelledby="install-preference">
          <div className={sectionLabelClass}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span id="install-preference">{t("preferences.install")}</span>
          </div>
          {canPromptInstall ? (
            <button
              type="button"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors duration-fast hover:border-interactive-border hover:bg-interactive hover:text-interactive-text active:scale-[0.97] active:duration-tap"
              onClick={() => void promptInstall()}
            >
              <Download className="h-4 w-4" />
              <span>{t("preferences.installApp")}</span>
            </button>
          ) : (
            <p className="flex items-start gap-2 text-sm leading-snug text-muted-foreground">
              <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t("preferences.installHint")}</span>
            </p>
          )}
        </section>
      )}
    </div>
  );
};
