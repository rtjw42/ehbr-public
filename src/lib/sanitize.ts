// ── Text sanitization ────────────────────────────────────────────────────────
// The XSS-strip layer for user-supplied text. DOMPurify with no allowed tags/attrs
// removes markup entirely. stripHtmlText trims (for form values); sanitizeDisplayText
// keeps surrounding whitespace (for rendering). All user input flows through one of
// these before it's stored or shown.
import DOMPurify from "dompurify";

export const stripHtmlText = (value: string) => (
  DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim()
);

export const sanitizeDisplayText = (value: string | null | undefined) => (
  DOMPurify.sanitize(value ?? "", { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
);
