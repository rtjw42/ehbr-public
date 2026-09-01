export const BOOKING_GUIDELINES_DISMISSED_KEY = "eb:booking-guidelines-dismissed";

export const hasDismissedBookingGuidelines = () => {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(BOOKING_GUIDELINES_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
};
