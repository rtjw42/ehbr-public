// Deployment-specific values. Nothing here is a secret, but nothing here is
// hardcoded either: each deployment supplies its own, so no personal address or
// org detail is committed to the repository.
//
// Set these in `.env.local` for local dev and in the host's environment
// variables for production. The fallbacks are deliberately obvious placeholders
// so a missing value is visible in the UI rather than silently wrong.

/**
 * Address shown in the privacy policy for data-access, correction, and deletion
 * requests. Required by the policy text, so set it before deploying publicly.
 */
export const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || "contact@example.com";
