-- Phase A conflict rule: a booking REQUEST cannot overlap an already-approved booking.
--
-- The no_approved_overlap EXCLUDE constraint
-- (20260607130000_prevent_overlapping_approved_bookings.sql) is partial —
-- WHERE (status = 'approved') — so it only keeps *approved* bookings from overlapping
-- each other. Pending requests can still be inserted overlapping an approved booking.
--
-- The pick-dates flow (and recurring) show approved slots as unavailable client-side,
-- but the client is never the authority. This adds the server-side guard: every
-- requested instance is checked against the approved set inside submit_booking_request,
-- and the whole submission is rejected if any instance overlaps. This closes the
-- check-then-write race for both custom (pick-dates) and pattern (recurring) requests.
--
-- Overlaps between two still-PENDING requests remain allowed (they compete; the admin
-- decides at approval time) — this only rejects request-vs-approved.
--
-- The exception text contains "overlaps" so the Edge Function's cleanErrorMessage and
-- the client's normalizeBookingError both map it to "That time is no longer available."
-- (a 409). Everything else is unchanged from the Foundation version of this RPC.

CREATE OR REPLACE FUNCTION public.submit_booking_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _title text := trim(coalesce(payload->>'title', ''));
  _name text := trim(coalesce(payload->>'name', ''));
  _info text := nullif(trim(coalesce(payload->>'info', '')), '');
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
  IF length(_title) = 0 OR length(_title) > 100 THEN
    RAISE EXCEPTION 'Booking title is required and must be 100 characters or fewer';
  END IF;

  IF length(_name) = 0 OR length(_name) > 100 THEN
    RAISE EXCEPTION 'Name is required and must be 100 characters or fewer';
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

  -- A group is one submission with >1 date: recurrence pattern OR custom pick-dates.
  IF _count > 1 THEN
    INSERT INTO public.booking_groups (recurrence, recurrence_end, kind)
    VALUES (
      CASE WHEN _recurrence <> 'none' THEN _recurrence END,
      CASE WHEN _recurrence <> 'none' THEN _recurrence_end END,
      CASE WHEN _recurrence <> 'none' THEN 'pattern' ELSE 'custom' END
    )
    RETURNING id INTO _group_id;
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    _start := (_item->>'start_time')::timestamptz;
    _end := (_item->>'end_time')::timestamptz;

    IF _end <= _start THEN
      RAISE EXCEPTION 'End time must be after start time';
    END IF;

    -- A request cannot overlap an already-approved booking (server-side authority).
    IF EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.status = 'approved'
        AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(_start, _end, '[)')
    ) THEN
      RAISE EXCEPTION 'Requested time overlaps an approved booking';
    END IF;

    INSERT INTO public.bookings (
      group_id,
      title,
      name,
      info,
      start_time,
      end_time,
      color_r,
      color_g,
      color_b,
      status
    )
    VALUES (
      _group_id,
      _title,
      _name,
      _info,
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

REVOKE ALL ON FUNCTION public.submit_booking_request(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_booking_request(jsonb) TO service_role;
