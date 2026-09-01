// Remember the booker's name in this browser so repeat bookers don't retype it.
// Purely client-side convenience (same localStorage pattern as booking-guidelines):
// there is deliberately NO server-side name store — that would rebuild a
// harvestable list of members. The value is just a name, low-stakes, and the
// prefilled field stays fully editable.
const BOOKER_NAME_KEY = "eb:booker-name";
const MAX_NAME_LENGTH = 100;

export const getRememberedBookerName = (): string => {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(BOOKER_NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

export const rememberBookerName = (name: string): void => {
  if (typeof window === "undefined") return;
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  try {
    if (trimmed) window.localStorage.setItem(BOOKER_NAME_KEY, trimmed);
  } catch {
    // Storage unavailable (private mode / quota) — prefill is best-effort.
  }
};
