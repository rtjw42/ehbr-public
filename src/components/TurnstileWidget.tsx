// ── Turnstile widget ─────────────────────────────────────────────────────────
// Wraps Cloudflare Turnstile's explicit-render widget. The script is loaded once and
// shared across instances via a module-level promise. Token, expiry, and error are
// surfaced through callbacks; parents bump `resetSignal` to force a fresh challenge
// (e.g. after a failed submit). Note the widget is only the *front* half of the check
// — the token is re-verified server-side in the Edge Functions.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MEDIA } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
          "timeout-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

const loadTurnstileScript = () => {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load verification challenge")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load verification challenge"));
    document.head.appendChild(script);
  });

  return scriptPromise;
};

type Props = {
  siteKey: string;
  onTokenChange: (token: string) => void;
  onExpired?: () => void;
  onError?: () => void;
  onReady?: () => void;
  resetSignal?: number;
};

export const TurnstileWidget = ({ siteKey, onTokenChange, onExpired, onError, onReady, resetSignal = 0 }: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onExpiredRef = useRef(onExpired);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);
  const [widgetSize] = useState<"compact" | "flexible">(() => (
    window.matchMedia(MEDIA.xsDown).matches ? "compact" : "flexible"
  ));

  // Keep the latest callbacks in refs so the render effect below depends only on
  // siteKey/size — the widget isn't torn down and rebuilt every time a parent
  // re-renders with new callback identities.
  useLayoutEffect(() => {
    onTokenChangeRef.current = onTokenChange;
    onExpiredRef.current = onExpired;
    onErrorRef.current = onError;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "auto",
          size: widgetSize,
          callback: (token) => onTokenChangeRef.current(token),
          "expired-callback": () => {
            onTokenChangeRef.current("");
            onExpiredRef.current?.();
          },
          "error-callback": () => {
            onTokenChangeRef.current("");
            onErrorRef.current?.();
          },
          "timeout-callback": () => {
            onTokenChangeRef.current("");
            onExpiredRef.current?.();
          },
        });
        onReadyRef.current?.();
      })
      .catch(() => {
        onTokenChangeRef.current("");
        onErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, widgetSize]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenChangeRef.current("");
    }
  }, [resetSignal]);

  // Reserve the height this size ACTUALLY renders at. Cloudflare's `compact` widget
  // is ~140px tall while `flexible` is ~65px, so a flat 65px reservation left the
  // panel jumping ~75px the moment the widget appeared — on xs phones, which have
  // the least room to spare. The size is fixed at mount, so this never changes.
  return (
    <div
      ref={containerRef}
      className={cn("turnstile-shell w-full", widgetSize === "compact" ? "min-h-[140px]" : "min-h-[65px]")}
    />
  );
};
