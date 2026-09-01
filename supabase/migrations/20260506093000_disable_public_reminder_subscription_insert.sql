DROP POLICY IF EXISTS "Anyone can subscribe" ON public.reminder_subscriptions;

REVOKE INSERT ON public.reminder_subscriptions FROM anon;
REVOKE INSERT ON public.reminder_subscriptions FROM authenticated;
