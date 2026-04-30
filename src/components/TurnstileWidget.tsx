import { useEffect, useRef, useState } from "react";

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
  resetSignal?: number;
};

export const TurnstileWidget = ({ siteKey, onTokenChange, onExpired, onError, resetSignal = 0 }: Props) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [widgetSize, setWidgetSize] = useState<"compact" | "flexible">("flexible");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 390px)");
    const updateSize = () => setWidgetSize(media.matches ? "compact" : "flexible");
    updateSize();
    media.addEventListener("change", updateSize);
    return () => media.removeEventListener("change", updateSize);
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: "auto",
          size: widgetSize,
          callback: onTokenChange,
          "expired-callback": () => {
            onTokenChange("");
            onExpired?.();
          },
          "error-callback": () => {
            onTokenChange("");
            onError?.();
          },
          "timeout-callback": () => {
            onTokenChange("");
            onExpired?.();
          },
        });
      })
      .catch(() => {
        onTokenChange("");
        onError?.();
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [onError, onExpired, onTokenChange, siteKey, widgetSize]);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onTokenChange("");
    }
  }, [onTokenChange, resetSignal]);

  return <div ref={containerRef} className="turnstile-shell min-h-[65px] w-full" />;
};
