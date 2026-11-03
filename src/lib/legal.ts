import type { LanguagePreference } from "@/contexts/preferences-context";
import * as enLegal from "@/lib/legal.en";
import * as zhLegal from "@/lib/legal.zh";

export type LegalLink = {
  label: string;
  href: string;
};

export type LegalBullet = {
  label?: string;
  text: string;
  href?: string;
};

export type LegalBlock = {
  heading: string;
  paragraphs?: string[];
  bullets?: LegalBullet[];
  links?: LegalLink[];
};

export type LegalCopy = {
  title: string;
  updated: string;
  blocks: LegalBlock[];
};

export type GuidelinesCopy = {
  title: string;
  intro: string;
  blocks: LegalBlock[];
};

export type LegalContent = {
  privacy: LegalCopy;
  terms: LegalCopy;
  bookingGuidelines: GuidelinesCopy;
};

const legalContentByLanguage = {
  en: {
    privacy: enLegal.PRIVACY_COPY,
    terms: enLegal.TERMS_COPY,
    bookingGuidelines: enLegal.BOOKING_GUIDELINES_COPY,
  },
  zh: {
    privacy: zhLegal.PRIVACY_COPY,
    terms: zhLegal.TERMS_COPY,
    bookingGuidelines: zhLegal.BOOKING_GUIDELINES_COPY,
  },
} satisfies Record<LanguagePreference, LegalContent>;

export const getLegalContent = (language: LanguagePreference): LegalContent => (
  legalContentByLanguage[language] ?? legalContentByLanguage.en
);
