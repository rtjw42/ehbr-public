-- Privacy + booking shape: remove the Telegram handle and introduce a booking
-- "title" distinct from the booker's name.
--
--   • DROP bookings.contact (the Telegram handle) — self-asserted PII, publicly
--     readable, a bulk-harvest surface. Members coordinate via their own group
--     chat. Dropping it also drops the dependent length check, and the per-person
--     pending checks (keyed on contact) go from submit_booking_request — anti-abuse
--     now rests on the submit-booking Edge Function (IP rate limit + Turnstile) and
--     the 1–366 session cap.
--   • ADD bookings.title — what the session is (e.g. "Jazz practice"). Existing
--     bookings had only a single label in `name`, so we backfill title := name for
--     them (their old name becomes the title). Going forward: title = purpose,
--     name = who booked.

-- New column, backfilled from the old single label, then locked NOT NULL.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS title text;
UPDATE public.bookings SET title = name WHERE title IS NULL;
ALTER TABLE public.bookings ALTER COLUMN title SET NOT NULL;
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_title_length_check,
  ADD CONSTRAINT bookings_title_length_check CHECK (length(trim(title)) > 0 AND length(title) <= 100);

ALTER TABLE public.bookings DROP COLUMN IF EXISTS contact;

-- ── Public request path (title + name, no contact, no per-person pending checks) ─
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

-- ── Admin create path (title + name, no contact) ────────────────────────────
CREATE OR REPLACE FUNCTION public.create_approved_booking_series(payload jsonb)
RETURNS SETOF public.bookings
LANGUAGE plpgsql
SECURITY INVOKER
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
  _group_id uuid := null;
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
      group_id, title, name, info, start_time, end_time, color_r, color_g, color_b, status, approved_by
    )
    SELECT
      _group_id, _title, _name, _info,
      (item->>'start_time')::timestamptz,
      (item->>'end_time')::timestamptz,
      _color_r, _color_g, _color_b, 'approved', auth.uid()
    FROM jsonb_array_elements(_items) AS item
    RETURNING *
  )
  SELECT * FROM inserted ORDER BY start_time;
END;
$$;
