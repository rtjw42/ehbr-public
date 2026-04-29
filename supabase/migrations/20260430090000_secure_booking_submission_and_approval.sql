-- Secure booking submission and approval flow.
-- Public clients must submit bookings through the submit-booking Edge Function,
-- which verifies Turnstile before calling public.submit_booking_request.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP POLICY IF EXISTS "Anyone can request a booking" ON public.bookings;
DROP POLICY IF EXISTS "Anyone can insert booking groups" ON public.booking_groups;

CREATE OR REPLACE FUNCTION public.submit_booking_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text := trim(coalesce(payload->>'name', ''));
  _contact text := trim(coalesce(payload->>'contact', ''));
  _recurrence public.recurrence_type := coalesce(nullif(payload->>'recurrence', ''), 'none')::public.recurrence_type;
  _recurrence_end date := nullif(payload->>'recurrence_end', '')::date;
  _color_r int := coalesce((payload->>'color_r')::int, 180);
  _color_g int := coalesce((payload->>'color_g')::int, 140);
  _color_b int := coalesce((payload->>'color_b')::int, 200);
  _items jsonb := payload->'bookings';
  _item jsonb;
  _group_id uuid := null;
  _start timestamptz;
  _end timestamptz;
  _count int;
BEGIN
  IF length(_name) = 0 OR length(_name) > 100 THEN
    RAISE EXCEPTION 'Name is required and must be 100 characters or fewer';
  END IF;

  IF length(_contact) = 0 OR length(_contact) > 100 THEN
    RAISE EXCEPTION 'Contact is required and must be 100 characters or fewer';
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

  IF _recurrence <> 'none' AND _count > 1 THEN
    INSERT INTO public.booking_groups (recurrence, recurrence_end)
    VALUES (_recurrence, _recurrence_end)
    RETURNING id INTO _group_id;
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    _start := (_item->>'start_time')::timestamptz;
    _end := (_item->>'end_time')::timestamptz;

    IF _end <= _start THEN
      RAISE EXCEPTION 'End time must be after start time';
    END IF;

    INSERT INTO public.bookings (
      group_id,
      name,
      contact,
      start_time,
      end_time,
      color_r,
      color_g,
      color_b,
      status
    )
    VALUES (
      _group_id,
      _name,
      _contact,
      _start,
      _end,
      _color_r,
      _color_g,
      _color_b,
      'pending'
    );
  END LOOP;

  RETURN jsonb_build_object('inserted_count', _count, 'group_id', _group_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_booking(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target public.bookings%rowtype;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _approved_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
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

ALTER TABLE public.bookings
ADD CONSTRAINT bookings_no_approved_overlap
EXCLUDE USING gist (
  tstzrange(start_time, end_time, '[)') WITH &&
)
WHERE (status = 'approved');

REVOKE EXECUTE ON FUNCTION public.submit_booking_request(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_booking_request(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_booking_request(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_booking_request(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.approve_booking(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_booking(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_booking_overwrite(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_booking_group_overwrite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_booking_overwrite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_booking_group_overwrite(uuid) TO authenticated;
