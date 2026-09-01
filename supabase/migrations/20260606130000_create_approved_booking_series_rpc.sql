-- Atomic admin recurring-booking creation.
--
-- The public path already goes through submit_booking_request (one transactional
-- RPC). The admin path previously did a client-side group-insert then a separate
-- bookings-insert (two round-trips, not atomic — a partial failure orphaned the
-- booking_group). This mirrors the public RPC for the admin path so the group +
-- bookings land in a single transaction.
--
-- SECURITY INVOKER: the function runs as the calling admin, so the existing RLS
-- policies ("Admins manage booking groups" / "Admins insert bookings", both
-- private.has_role(auth.uid(), 'admin')) authorize it — no in-function role check
-- needed, and non-admins simply hit an RLS violation.

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
      group_id, name, contact, info, start_time, end_time, color_r, color_g, color_b, status
    )
    SELECT
      _group_id, _name, _contact, _info,
      (item->>'start_time')::timestamptz,
      (item->>'end_time')::timestamptz,
      _color_r, _color_g, _color_b, 'approved'
    FROM jsonb_array_elements(_items) AS item
    RETURNING *
  )
  SELECT * FROM inserted ORDER BY start_time;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_approved_booking_series(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_approved_booking_series(jsonb) TO authenticated;
