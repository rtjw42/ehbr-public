-- Bound what a public booking REQUEST may contain.
--
-- The Edge Function forwards `bookings[]` verbatim (only title/name/info are
-- sanitized), so start/end came straight from the client. The RPC checked
-- `end > start` and the array length, but never the MAGNITUDE — so a crafted POST
-- could file pending rows dated 1904 or 2400.
--
-- Why that mattered: the admin surface loads bookings ordered by start_time with a
-- row budget. Far-past junk sorts FIRST and eats that budget, pushing real pending
-- requests out of the query — the admin queue silently stops showing genuine
-- requests. Bounding the range here is what keeps that ordering safe.
--
-- Limits reject the absurd, never the plausible. The UI already floors bookings at
-- the next 15-min slot, so these only have to cover what the UI cannot:
--   • 1 hour of backdating — purely for client/server clock skew. The client builds
--     start_time from the BROWSER's clock, so a device running a few minutes slow
--     would otherwise have a valid "now" booking rejected.
--   • 18 months ahead. The band runs on a yearly intake (Aug–May academic year), so
--     the real planning horizon is "the next academic year" — which, set up late in
--     the current one, reaches ~12 months out. 18 months leaves genuine room for
--     that without admitting the absurd.
--   • a single session under 7 days — multi-day bookings are real and rendered
--     (isMultiDay / fmtBookingSpan), so this stays clear of them while still
--     rejecting a span of months.
--   • 60 sessions per submission. The 1-year horizon caps weekly at ~53 and the UI
--     caps pick-dates at 10, so 60 cannot reject a real submission. (366 was a
--     recurrence safety backstop, never a public submission budget.)
--
-- Admin-created bookings are unaffected: create_approved_booking_series is a
-- separate RPC, gated by RLS, and admins may legitimately record historical bookings.

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
  IF _count < 1 OR _count > 60 THEN
    RAISE EXCEPTION 'Booking request must include between 1 and 60 sessions';
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

    IF _start IS NULL OR _end IS NULL THEN
      RAISE EXCEPTION 'Each session must have a start and end time';
    END IF;

    IF _end <= _start THEN
      RAISE EXCEPTION 'End time must be after start time';
    END IF;

    -- Reject the absurd. Also rejects 'infinity'/'-infinity', which are valid
    -- timestamptz values and would otherwise pass every check above.
    IF _start < now() - interval '1 hour' OR _start > now() + interval '18 months' THEN
      RAISE EXCEPTION 'Booking date must be within the next 18 months';
    END IF;

    IF _end > _start + interval '7 days' THEN
      RAISE EXCEPTION 'A single session must be shorter than 7 days';
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
