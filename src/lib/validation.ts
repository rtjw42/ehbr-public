// Lightweight, ReDoS-safe email check for client-side hints only. The server
// (Supabase Auth + Edge Functions) is the authoritative validator — this just
// gates inline UI. The pattern is linear (no nested quantifiers) so it can't
// catastrophically backtrack.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());
