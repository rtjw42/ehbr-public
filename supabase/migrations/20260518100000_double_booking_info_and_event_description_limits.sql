ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_info_length_check,
ADD CONSTRAINT bookings_info_length_check CHECK (info IS NULL OR length(info) <= 400);

ALTER TABLE public.events
DROP CONSTRAINT IF EXISTS events_description_length_check,
ADD CONSTRAINT events_description_length_check CHECK (description IS NULL OR length(description) <= 400);

CREATE OR REPLACE FUNCTION public.submit_booking_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text := trim(coalesce(payload->>'name', ''));
  _contact text := trim(coalesce(payload->>'contact', ''));
  _info text := nullif(trim(coalesce(payload->>'info', '')), '');
  _contact_key text := lower(trim(coalesce(payload->>'contact', '')));
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
  _pending_request_count int;
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

  SELECT count(*)
  INTO _pending_request_count
  FROM (
    SELECT coalesce(group_id::text, id::text) AS request_key
    FROM public.bookings
    WHERE status = 'pending'
      AND lower(trim(contact)) = _contact_key
    GROUP BY coalesce(group_id::text, id::text)
  ) pending_requests;

  IF _pending_request_count >= 3 THEN
    RAISE EXCEPTION 'You have too many pending booking requests.';
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

    IF EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.status = 'pending'
        AND lower(trim(b.contact)) = _contact_key
        AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(_start, _end, '[)')
    ) THEN
      RAISE EXCEPTION 'You already have a pending booking for this time.';
    END IF;

    INSERT INTO public.bookings (
      group_id,
      name,
      contact,
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
      _name,
      _contact,
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
