// ── Untrusted free-text guard ────────────────────────────────────────────────
// Detects links and neutralizes hiding/spoofing tricks in public form input
// (booking title / name / info). The public booking form is anonymous, so a
// link in a field becomes a phishing/spam vector — Telegram auto-linkifies bare
// URLs, bare domains, t.me invites, and @mentions client-side regardless of
// parse_mode, so HTML-escaping alone does NOT stop it. We reject links at the
// input boundary instead.
//
// MIRROR COPY: kept in sync with supabase/functions/_shared/text-guard.ts (the
// client build root can't import from the Deno functions root — same pattern as
// telegram-format). Change both together. Pure — no imports, no browser/Deno
// globals — so it runs in Vitest, the browser, and Deno alike.

// Zero-width spaces, bidi overrides (U+202E can visually reverse text), word
// joiners, and the BOM — used to hide characters or spoof how text renders.
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

// Normalize and de-weaponize a free-text value: NFC normalize, drop invisible
// control chars, and collapse whitespace flooding (a title full of newlines
// breaks the Telegram board layout). Single-line fields collapse ALL runs of
// whitespace to one space; multiline (info) keeps single newlines but caps
// blank-line runs and collapses horizontal runs.
export const sanitizeFreeText = (value: unknown, multiline = false): string => {
  if (typeof value !== "string") return "";
  let out = value.normalize("NFC").replace(INVISIBLE_CHARS, "");
  if (multiline) {
    out = out.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n");
  } else {
    out = out.replace(/\s+/g, " ");
  }
  return out.trim();
};

// Bare-domain detection is limited to a curated TLD list so ordinary text with a
// dot ("Rock.Pop", "feat.") is NOT flagged, while "free-robux.tk" is. Schemes,
// www., and t.me are caught regardless of TLD.
const LINK_PATTERNS: RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\//i, // any scheme:// (http, https, ftp, tg, ...)
  /\bwww\.[a-z0-9-]/i, // www.<something>
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|co|me|gg|xyz|app|dev|link|tk|ml|ga|cf|info|biz|site|online|store|shop|club|live|to|ly|be|ru|cn|uk|sg)\b/i,
  /(?:^|[^\w@])@[a-z][a-z0-9_]{4,}\b/i, // @handle (Telegram usernames are 5+ chars)
];

// True if the value contains anything that would render as a tappable link or
// mention. All patterns are linear (no nested quantifiers) — ReDoS-safe.
export const containsLink = (value: string): boolean =>
  LINK_PATTERNS.some((re) => re.test(value));
