-- "Approved by" — record which admin approved a booking, and give admins an
-- editable display name shown alongside it.
--
-- Two new pieces of state:
--   • public.admin_profiles  — one row per admin, holding an editable display_name.
--     SELECT is public (anon + authenticated) because the approver's name is shown
--     on the public calendar. Writes are restricted to the admin's OWN row.
--   • public.bookings.approved_by — the approving admin's user_id, set inside the
--     approval RPCs. FK → admin_profiles(user_id) so the public read can embed the
--     current display_name (renames reflect everywhere, no stale snapshot).
--
-- Default display_name is the generic 'Admin' so no email/PII leaks publicly before
-- an admin sets a real name.

-- ── admin_profiles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Admin' CHECK (length(display_name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

-- Public read: the approver name is surfaced on the public calendar. Only user_id
-- (an opaque UUID) and display_name are exposed.
DROP POLICY IF EXISTS "Anyone can view admin display names" ON public.admin_profiles;
CREATE POLICY "Anyone can view admin display names"
ON public.admin_profiles
FOR SELECT
USING (true);

-- An admin may create/update ONLY their own profile row.
DROP POLICY IF EXISTS "Admins insert own profile" ON public.admin_profiles;
CREATE POLICY "Admins insert own profile"
ON public.admin_profiles
FOR INSERT
WITH CHECK (auth.uid() = user_id AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update own profile" ON public.admin_profiles;
CREATE POLICY "Admins update own profile"
ON public.admin_profiles
FOR UPDATE
USING (auth.uid() = user_id AND private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (auth.uid() = user_id AND private.has_role(auth.uid(), 'admin'::public.app_role));

-- Keep updated_at honest on rename.
CREATE OR REPLACE FUNCTION public.touch_admin_profile_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_profiles_touch_updated_at ON public.admin_profiles;
CREATE TRIGGER admin_profiles_touch_updated_at
BEFORE UPDATE ON public.admin_profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_admin_profile_updated_at();

-- Auto-provision a profile when a user is granted the admin role, so the
-- approved_by FK always resolves for any admin who can approve. SECURITY DEFINER
-- so it runs regardless of the granting context; idempotent on conflict.
CREATE OR REPLACE FUNCTION public.ensure_admin_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin'::public.app_role THEN
    INSERT INTO public.admin_profiles (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_ensure_admin_profile ON public.user_roles;
CREATE TRIGGER user_roles_ensure_admin_profile
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.ensure_admin_profile();

-- Backfill profiles for existing admins.
INSERT INTO public.admin_profiles (user_id)
SELECT DISTINCT user_id
FROM public.user_roles
WHERE role = 'admin'::public.app_role
ON CONFLICT (user_id) DO NOTHING;

-- ── bookings.approved_by ─────────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS approved_by uuid;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_approved_by_fkey;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES public.admin_profiles(user_id) ON DELETE SET NULL;

-- Backfill existing approved bookings to the master admin (per owner decision).
UPDATE public.bookings b
SET approved_by = ur.user_id
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
WHERE b.status = 'approved'
  AND b.approved_by IS NULL
  AND ur.role = 'admin'::public.app_role
  AND lower(coalesce(u.email, '')) = 'owner@example.com';

-- ── Stamp approved_by inside the approval RPCs ───────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  UPDATE public.bookings
  SET status = 'approved', approved_by = auth.uid()
  WHERE id = _booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_booking_overwrite(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _target public.bookings%rowtype;
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  SELECT *
  INTO _target
  FROM public.bookings
  WHERE id = _booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  UPDATE public.bookings
  SET status = 'rejected'
  WHERE status = 'approved'
    AND id <> _target.id
    AND tstzrange(start_time, end_time, '[)') && tstzrange(_target.start_time, _target.end_time, '[)');

  UPDATE public.bookings
  SET status = 'approved', approved_by = auth.uid()
  WHERE id = _target.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_booking_group_overwrite(_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _approved_count integer;
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  WITH target AS (
    SELECT id, start_time, end_time
    FROM public.bookings
    WHERE group_id = _group_id
    FOR UPDATE
  ),
  rejected AS (
    UPDATE public.bookings b
    SET status = 'rejected'
    WHERE b.status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM target t WHERE t.id = b.id)
      AND EXISTS (
        SELECT 1
        FROM target t
        WHERE tstzrange(b.start_time, b.end_time, '[)') && tstzrange(t.start_time, t.end_time, '[)')
      )
    RETURNING b.id
  ),
  approved AS (
    UPDATE public.bookings b
    SET status = 'approved', approved_by = auth.uid()
    WHERE EXISTS (SELECT 1 FROM target t WHERE t.id = b.id)
    RETURNING b.id
  )
  SELECT count(*) INTO _approved_count FROM approved;

  IF _approved_count = 0 THEN
    RAISE EXCEPTION 'Booking group not found';
  END IF;

  RETURN _approved_count;
END;
$$;

-- Admin-created bookings are inserted already-approved → stamp the creating admin.
CREATE OR REPLACE FUNCTION public.create_approved_booking_series(payload jsonb)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _name text := trim(coalesce(payload->>'name', ''));
  _contact text := trim(coalesce(payload->>'contact', ''));
  _info text := nullif(trim(coalesce(payload->>'info', '')), '');
  _recurrence public.recurrence_type := coalesce(nullif(payload->>'recurrence', ''), 'none')::public.recurrence_type;
  _recurrence_end date := nullif(payload->>'recurrence_end', '')::date;
  _color_r int := coalesce((payload->>'color_r')::int, 180);
  _color_g int := coalesce((payload->>'color_g')::int, 140);
  _color_b int := coalesce((payload->>'color_b')::int, 200);
  _items jsonb := payload->'bookings';
  _group_id uuid := null;
  _count int;
BEGIN
  IF length(_name) = 0 OR length(_name) > 100 THEN
    RAISE EXCEPTION 'Name is required and must be 100 characters or fewer';
  END IF;

  IF length(_contact) = 0 OR length(_contact) > 100 THEN
    RAISE EXCEPTION 'Contact is required and must be 100 characters or fewer';
  END IF;

  IF _info IS NOT NULL AND length(_info) > 400 THEN
    RAISE EXCEPTION 'Info must be 400 characters or fewer';
  END IF;

  IF _color_r NOT BETWEEN 0 AND 255 OR _color_g NOT BETWEEN 0 AND 255 OR _color_b NOT BETWEEN 0 AND 255 THEN
    RAISE EXCEPTION 'Invalid booking color';
  END IF;

  IF jsonb_typeof(_items) <> 'array' THEN
    RAISE EXCEPTION 'Bookings must be an array';
  END IF;

  _count := jsonb_array_length(_items);
  IF _count < 1 OR _count > 366 THEN
    RAISE EXCEPTION 'Booking request must include between 1 and 366 sessions';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_items) AS item
    WHERE (item->>'end_time')::timestamptz <= (item->>'start_time')::timestamptz
  ) THEN
    RAISE EXCEPTION 'End time must be after start time';
  END IF;

  IF _recurrence <> 'none' AND _count > 1 THEN
    INSERT INTO public.booking_groups (recurrence, recurrence_end)
    VALUES (_recurrence, _recurrence_end)
    RETURNING id INTO _group_id;
  END IF;

  RETURN QUERY
  WITH inserted AS (
    INSERT INTO public.bookings (
      group_id, name, contact, info, start_time, end_time, color_r, color_g, color_b, status, approved_by
    )
    SELECT
      _group_id, _name, _contact, _info,
      (item->>'start_time')::timestamptz,
      (item->>'end_time')::timestamptz,
      _color_r, _color_g, _color_b, 'approved', auth.uid()
    FROM jsonb_array_elements(_items) AS item
    RETURNING *
  )
  SELECT * FROM inserted ORDER BY start_time;
END;
$$;
