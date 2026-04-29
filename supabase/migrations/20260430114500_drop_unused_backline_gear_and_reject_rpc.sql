-- Remove unused Backline gear rows table and obsolete reject RPC.
-- Backline now uses backline_content for Gear/Rates content, and pending rejects delete rows directly.

DROP POLICY IF EXISTS "Anyone can view backline gear" ON public.backline_gear;
DROP POLICY IF EXISTS "Admins can insert backline gear" ON public.backline_gear;
DROP POLICY IF EXISTS "Admins can update backline gear" ON public.backline_gear;
DROP POLICY IF EXISTS "Admins can delete backline gear" ON public.backline_gear;

DROP TRIGGER IF EXISTS update_backline_gear_updated_at ON public.backline_gear;

DROP TABLE IF EXISTS public.backline_gear;

DROP FUNCTION IF EXISTS public.reject_booking(uuid);
