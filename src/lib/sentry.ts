// Error monitoring, initialized lazily and ONLY after the user accepts the consent
// gate (called from ConsentGate). Prod-only, no PII, dynamically imported so the
// Sentry SDK never weighs down the initial bundle, and failures are swallowed so
// monitoring can't break the app.
let sentryInitPromise: Promise<void> | null = null;

export const initSentryAfterConsent = () => {
  if (!import.meta.env.PROD) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  if (sentryInitPromise) return;

  sentryInitPromise = import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        sendDefaultPii: false,
        environment: import.meta.env.MODE,
      });
    })
    .catch(() => {
      // Monitoring must never break the app.
      sentryInitPromise = null;
    });
};
