import { useCallback, useSyncExternalStore } from "react";

// Add-to-Home-Screen state, shared app-wide. The browser's install signal
// (`beforeinstallprompt`) can fire before any component mounts, so we capture it
// at module load into a tiny external store and let components subscribe. No
// service worker involved — this only surfaces the browser's own install path.

// `BeforeInstallPromptEvent` isn't in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let version = 0;
const listeners = new Set<() => void>();

const emit = () => {
  version += 1;
  listeners.forEach((notify) => notify());
};

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

const getSnapshot = () => version;

// Running as an installed app (Android/desktop standalone, or iOS home-screen).
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true);

// iOS can't install programmatically (Apple exposes no hook); only Safari's Share
// sheet offers "Add to Home Screen", so exclude Chrome/Firefox/Edge on iOS.
const isIosSafari = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferredPrompt = null;
    emit();
  });
}

export const useInstallPrompt = () => {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const promptInstall = useCallback(async () => {
    const promptEvent = deferredPrompt;
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    deferredPrompt = null;
    if (choice.outcome === "accepted") installed = true;
    emit();
  }, []);

  const standalone = isStandalone();
  return {
    // Android / desktop Chromium: real one-tap install available.
    canPromptInstall: !!deferredPrompt && !installed && !standalone,
    // iOS Safari, not yet installed: show manual Share-sheet instructions.
    showIosHint: isIosSafari() && !installed && !standalone,
    promptInstall,
  };
};
