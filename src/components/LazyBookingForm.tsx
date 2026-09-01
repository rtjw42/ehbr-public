import { lazy } from "react";
import { loadBookingForm } from "@/lib/booking-form-loader";

export const LazyBookingForm = lazy(loadBookingForm);
