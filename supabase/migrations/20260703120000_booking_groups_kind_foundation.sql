-- Foundation for grouped bookings: "a group is one submission".
--
-- Until now a booking_groups row only ever represented a *recurrence pattern*
-- (daily/weekly/monthly): recurrence was NOT NULL, and a group was created only
-- when `recurrence <> 'none' AND count > 1`. The grouped-bookings work redefines a
-- group as *any multi-date submission* — a recurrence pattern OR a hand-picked set
-- of irregular dates ("custom"). This migration lets the table represent both and
-- flips both insert RPCs to group on `count > 1` alone.
--
--   • recurrence / recurrence_end become NULLABLE — a custom group has no pattern.
--   • new `kind` column ('pattern' | 'custom') lets display/message logic label a
--     group ("Weekly until 30 Jun" vs "5 selected dates") from the group row alone.
--   • backfill every existing group to kind='pattern' (all were recurrence patterns
--     by construction — a group was never created for recurrence='none').
--   • a CHECK keeps kind and recurrence consistent: pattern ⇒ recurrence present,
--     custom ⇒ recurrence NULL — so `kind` is always trustworthy.
--
-- Behaviour-neutral in the current UI: the only path that today produces count > 1
-- is a recurrence, which still lands as kind='pattern'. The custom branch stays
-- dormant until the pick-dates UI (Phase A) can submit irregular dates.

-- ── 1) Column shape ─────────────────────────────────────────────────────────
ALTER TABLE public.booking_groups ALTER COLUMN recurrence DROP NOT NULL;
ALTER TABLE public.booking_groups ALTER COLUMN recurrence DROP DEFAULT;

ALTER TABLE public.booking_groups ADD COLUMN IF NOT EXISTS kind text;
UPDATE public.booking_groups SET kind = 'pattern' WHERE kind IS NULL;
ALTER TABLE public.booking_groups ALTER COLUMN kind SET NOT NULL;

ALTER TABLE public.booking_groups
  DROP CONSTRAINT IF EXISTS booking_groups_kind_check,
  ADD CONSTRAINT booking_groups_kind_check CHECK (
    (kind = 'pattern' AND recurrence IS NOT NULL)
    OR (kind = 'custom' AND recurrence IS NULL)
  );

-- ── 2) Public request path — group on count > 1 (pattern or custom) ─────────
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

-- ── 3) Admin create path — group on count > 1 (pattern or custom) ───────────
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

REVOKE EXECUTE ON FUNCTION public.create_approved_booking_series(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_approved_booking_series(jsonb) TO authenticated;
