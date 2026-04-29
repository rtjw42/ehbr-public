-- Move role helper checks out of the exposed public API surface and make
-- booking admin RPCs run as the authenticated caller instead of as definer.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION private.is_master_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.has_role(auth.uid(), 'admin'::public.app_role)
    AND lower(coalesce(auth.jwt() ->> 'email', '')) = 'rtjw42@gmail.com'
$$;

GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_role(UUID, public.app_role) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_master_admin() TO anon, authenticated, service_role;

-- Core role and booking policies.
DROP POLICY IF EXISTS "Admins view all roles" ON public.user_roles;
CREATE POLICY "Admins view all roles"
ON public.user_roles
FOR SELECT
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage booking groups" ON public.booking_groups;
CREATE POLICY "Admins manage booking groups"
ON public.booking_groups
FOR ALL
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins view all bookings" ON public.bookings;
CREATE POLICY "Admins view all bookings"
ON public.bookings
FOR SELECT
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins update bookings" ON public.bookings;
CREATE POLICY "Admins update bookings"
ON public.bookings
FOR UPDATE
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins delete bookings" ON public.bookings;
CREATE POLICY "Admins delete bookings"
ON public.bookings
FOR DELETE
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Events and event poster storage.
DROP POLICY IF EXISTS "Admins can insert events" ON public.events;
CREATE POLICY "Admins can insert events"
ON public.events
FOR INSERT
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update events" ON public.events;
CREATE POLICY "Admins can update events"
ON public.events
FOR UPDATE
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete events" ON public.events;
CREATE POLICY "Admins can delete events"
ON public.events
FOR DELETE
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can upload event posters" ON storage.objects;
CREATE POLICY "Admins can upload event posters"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'event-posters' AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update event posters" ON storage.objects;
CREATE POLICY "Admins can update event posters"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'event-posters' AND private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'event-posters' AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete event posters" ON storage.objects;
CREATE POLICY "Admins can delete event posters"
ON storage.objects
FOR DELETE
USING (bucket_id = 'event-posters' AND private.has_role(auth.uid(), 'admin'::public.app_role));

-- Reminder subscriptions.
DROP POLICY IF EXISTS "Admins view all subscriptions" ON public.reminder_subscriptions;
CREATE POLICY "Admins view all subscriptions"
ON public.reminder_subscriptions
FOR SELECT
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage subscriptions" ON public.reminder_subscriptions;
CREATE POLICY "Admins manage subscriptions"
ON public.reminder_subscriptions
FOR ALL
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Invite codes.
DROP POLICY IF EXISTS "Master admin views invite codes" ON public.admin_invite_codes;
CREATE POLICY "Master admin views invite codes"
ON public.admin_invite_codes
FOR SELECT
USING (private.is_master_admin());

DROP POLICY IF EXISTS "Master admin creates invite codes" ON public.admin_invite_codes;
CREATE POLICY "Master admin creates invite codes"
ON public.admin_invite_codes
FOR INSERT
WITH CHECK (private.is_master_admin());

DROP POLICY IF EXISTS "Master admin updates invite codes" ON public.admin_invite_codes;
CREATE POLICY "Master admin updates invite codes"
ON public.admin_invite_codes
FOR UPDATE
USING (private.is_master_admin())
WITH CHECK (private.is_master_admin());

DROP POLICY IF EXISTS "Master admin deletes invite codes" ON public.admin_invite_codes;
CREATE POLICY "Master admin deletes invite codes"
ON public.admin_invite_codes
FOR DELETE
USING (private.is_master_admin());

-- Backline gear and document storage.
DROP POLICY IF EXISTS "Admins can insert backline gear" ON public.backline_gear;
CREATE POLICY "Admins can insert backline gear"
ON public.backline_gear
FOR INSERT
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update backline gear" ON public.backline_gear;
CREATE POLICY "Admins can update backline gear"
ON public.backline_gear
FOR UPDATE
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete backline gear" ON public.backline_gear;
CREATE POLICY "Admins can delete backline gear"
ON public.backline_gear
FOR DELETE
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can upload backline documents" ON storage.objects;
CREATE POLICY "Admins can upload backline documents"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'backline-documents' AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update backline documents" ON storage.objects;
CREATE POLICY "Admins can update backline documents"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'backline-documents' AND private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'backline-documents' AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete backline documents" ON storage.objects;
CREATE POLICY "Admins can delete backline documents"
ON storage.objects
FOR DELETE
USING (bucket_id = 'backline-documents' AND private.has_role(auth.uid(), 'admin'::public.app_role));

-- Backline content and editable contacts.
DROP POLICY IF EXISTS "Admins can insert backline content" ON public.backline_content;
CREATE POLICY "Admins can insert backline content"
ON public.backline_content
FOR INSERT
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update backline content" ON public.backline_content;
CREATE POLICY "Admins can update backline content"
ON public.backline_content
FOR UPDATE
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete backline content" ON public.backline_content;
CREATE POLICY "Admins can delete backline content"
ON public.backline_content
FOR DELETE
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Anyone can view active site contacts" ON public.site_contacts;
CREATE POLICY "Anyone can view active site contacts"
ON public.site_contacts
FOR SELECT
USING (active = true OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can insert site contacts" ON public.site_contacts;
CREATE POLICY "Admins can insert site contacts"
ON public.site_contacts
FOR INSERT
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update site contacts" ON public.site_contacts;
CREATE POLICY "Admins can update site contacts"
ON public.site_contacts
FOR UPDATE
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete site contacts" ON public.site_contacts;
CREATE POLICY "Admins can delete site contacts"
ON public.site_contacts
FOR DELETE
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Anyone can view active site contact fields" ON public.site_contact_fields;
CREATE POLICY "Anyone can view active site contact fields"
ON public.site_contact_fields
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.site_contacts c
    WHERE c.id = site_contact_fields.contact_id
      AND (c.active = true OR private.has_role(auth.uid(), 'admin'::public.app_role))
  )
);

DROP POLICY IF EXISTS "Admins can insert site contact fields" ON public.site_contact_fields;
CREATE POLICY "Admins can insert site contact fields"
ON public.site_contact_fields
FOR INSERT
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update site contact fields" ON public.site_contact_fields;
CREATE POLICY "Admins can update site contact fields"
ON public.site_contact_fields
FOR UPDATE
USING (private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete site contact fields" ON public.site_contact_fields;
CREATE POLICY "Admins can delete site contact fields"
ON public.site_contact_fields
FOR DELETE
USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Recreate booking admin RPCs as invoker functions. Existing RLS policies now
-- authorize the underlying updates, and the explicit role check gives clearer errors.
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
  SET status = 'approved'
  WHERE id = _booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_booking(_booking_id uuid)
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
  SET status = 'rejected'
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
  SET status = 'approved'
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
    SET status = 'approved'
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

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_master_admin() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_booking(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_booking(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_booking_overwrite(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_booking_group_overwrite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_booking_overwrite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_booking_group_overwrite(uuid) TO authenticated;
