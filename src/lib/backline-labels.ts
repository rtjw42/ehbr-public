import type { Translate } from "@/lib/i18n";

// Section display names, shared by the public Backline page (the card eyebrow) and
// the admin content dialog (its title). It lives here rather than in either of them
// because the dialog is lazy-loaded: a helper exported from the dialog would make
// the page import it statically and pull the whole admin form back into the public
// page chunk, which is exactly what the extraction removed.
export const backlineSectionLabel = (sectionKey: string, t: Translate) => {
  if (sectionKey === "gear") return t("backline.section.gear");
  if (sectionKey === "rates") return t("backline.section.rates");
  return sectionKey;
};
