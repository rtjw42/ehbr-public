-- Allow admins to add approved bookings directly from the admin panel.
-- Public booking creation remains restricted to the Turnstile-protected Edge Function.

DROP POLICY IF EXISTS "Admins insert bookings" ON public.bookings;
CREATE POLICY "Admins insert bookings"
ON public.bookings
FOR INSERT
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
