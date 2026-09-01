export const loadBookingForm = () => import("@/components/BookingForm").then((module) => ({ default: module.BookingForm }));

export const preloadBookingForm = () => {
  void loadBookingForm();
};
