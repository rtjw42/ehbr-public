// ── Form loaders ──────────────────────────────────────────────────────────────
// The single home for every popup form's dynamic import, and for the preload that
// warms it on intent (pointer-enter / focus of the button that opens it).
//
// Why one module rather than a `lazy(() => import(...))` sitting in each page: a
// form is opened from more than one place (the setlist editor from both /media and
// /media/:id), and the preload has to reference the *same* import specifier as the
// `lazy()` or the browser fetches the chunk twice. Keeping both halves side by side
// makes that impossible to get wrong.
//
// Everything here is a dynamic import, so nothing in this file pulls a form into
// the bundle of whoever imports it. But `lazy()` alone is not enough for an
// admin-only form: the chunk is fetched as soon as the component mounts, so the
// host must ALSO render it behind `{showAdminControls && …}`. BookingForm is the
// exception — it is public, so warming it eagerly is the point.
import { lazy } from "react";

const loadBookingForm = () =>
  import("@/components/BookingForm").then((module) => ({ default: module.BookingForm }));

const loadEventForm = () =>
  import("@/components/EventForm").then((module) => ({ default: module.EventForm }));

const loadBacklineForm = () =>
  import("@/components/BacklineForm").then((module) => ({ default: module.BacklineForm }));

const loadContactsForm = () =>
  import("@/components/ContactsForm").then((module) => ({ default: module.ContactsForm }));

const loadMediaSetlistForm = () =>
  import("@/components/MediaSetlistForm").then((module) => ({ default: module.MediaSetlistForm }));

// Fire-and-forget: a failed preload is not an error, because the `lazy()` boundary
// will request the same chunk again when the form actually opens.
const preload = (load: () => Promise<unknown>) => () => {
  void load().catch(() => {});
};

export const preloadBookingForm = preload(loadBookingForm);
export const preloadEventForm = preload(loadEventForm);
export const preloadBacklineForm = preload(loadBacklineForm);
export const preloadContactsForm = preload(loadContactsForm);
export const preloadMediaSetlistForm = preload(loadMediaSetlistForm);

// Lazy components, defined here so a form opened from two pages is one component
// identity (and one chunk request) rather than two. All five live here: BookingForm's
// used to sit in its own `components/LazyBookingForm.tsx`, left over from the deleted
// `lib/booking-form-loader.ts` it was written against — so `/bookings` imported the
// component from one module and its preload from another, which is exactly the split
// this file exists to close.
export const LazyBookingForm = lazy(loadBookingForm);
export const LazyEventForm = lazy(loadEventForm);
export const LazyBacklineForm = lazy(loadBacklineForm);
export const LazyContactsForm = lazy(loadContactsForm);
export const LazyMediaSetlistForm = lazy(loadMediaSetlistForm);
