CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (length(trim(scope)) > 0 AND length(scope) <= 80),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.rate_limit_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
ON private.rate_limit_events(scope, subject_hash, created_at DESC);

REVOKE ALL ON private.rate_limit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON private.rate_limit_events TO service_role;

CREATE OR REPLACE FUNCTION public.security_rate_limit_hit(
  _scope text,
  _subject_hash text,
  _max_attempts integer,
  _window interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  _count integer;
BEGIN
  IF _max_attempts < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_scope || ':' || _subject_hash)::bigint);

  DELETE FROM private.rate_limit_events
  WHERE created_at < now() - interval '24 hours';

  SELECT count(*)
  INTO _count
  FROM private.rate_limit_events
  WHERE scope = _scope
    AND subject_hash = _subject_hash
    AND created_at >= now() - _window;

  IF _count >= _max_attempts THEN
    RETURN false;
  END IF;

  INSERT INTO private.rate_limit_events(scope, subject_hash)
  VALUES (_scope, _subject_hash);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.security_rate_limit_blocked(
  _scope text,
  _subject_hash text,
  _max_attempts integer,
  _window interval
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  _count integer;
BEGIN
  SELECT count(*)
  INTO _count
  FROM private.rate_limit_events
  WHERE scope = _scope
    AND subject_hash = _subject_hash
    AND created_at >= now() - _window;

  RETURN _count >= _max_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.security_is_valid_admin_invite(_invite_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_invite_codes
    WHERE active = true
      AND code_hash = public.hash_admin_invite_code(_invite_code)
      AND (expires_at IS NULL OR expires_at > now())
      AND used_count < max_uses
  );
$$;

REVOKE ALL ON FUNCTION public.security_rate_limit_hit(text, text, integer, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_rate_limit_blocked(text, text, integer, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_is_valid_admin_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_rate_limit_hit(text, text, integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_rate_limit_blocked(text, text, integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_is_valid_admin_invite(text) TO service_role;

ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_name_check,
DROP CONSTRAINT IF EXISTS bookings_contact_check,
DROP CONSTRAINT IF EXISTS bookings_name_length_check,
DROP CONSTRAINT IF EXISTS bookings_contact_length_check,
ADD CONSTRAINT bookings_name_length_check CHECK (length(trim(name)) > 0 AND length(name) <= 100),
ADD CONSTRAINT bookings_contact_length_check CHECK (length(trim(contact)) > 0 AND length(contact) <= 100);

ALTER TABLE public.events
DROP CONSTRAINT IF EXISTS events_title_length_check,
DROP CONSTRAINT IF EXISTS events_description_length_check,
DROP CONSTRAINT IF EXISTS events_location_length_check,
ADD CONSTRAINT events_title_length_check CHECK (length(trim(title)) > 0 AND length(title) <= 255),
ADD CONSTRAINT events_description_length_check CHECK (description IS NULL OR length(description) <= 255),
ADD CONSTRAINT events_location_length_check CHECK (location IS NULL OR length(location) <= 255);

ALTER TABLE public.backline_content
DROP CONSTRAINT IF EXISTS backline_content_title_check,
DROP CONSTRAINT IF EXISTS backline_content_title_length_check,
DROP CONSTRAINT IF EXISTS backline_content_body_text_length_check,
ADD CONSTRAINT backline_content_title_length_check CHECK (length(trim(title)) > 0 AND length(title) <= 255),
ADD CONSTRAINT backline_content_body_text_length_check CHECK (body_text IS NULL OR length(body_text) <= 5000);

ALTER TABLE public.site_contacts
DROP CONSTRAINT IF EXISTS site_contacts_label_check,
DROP CONSTRAINT IF EXISTS site_contacts_label_length_check,
ADD CONSTRAINT site_contacts_label_length_check CHECK (length(trim(label)) > 0 AND length(label) <= 255);

ALTER TABLE public.site_contact_fields
DROP CONSTRAINT IF EXISTS site_contact_fields_label_check,
DROP CONSTRAINT IF EXISTS site_contact_fields_value_check,
DROP CONSTRAINT IF EXISTS site_contact_fields_label_length_check,
DROP CONSTRAINT IF EXISTS site_contact_fields_value_length_check,
ADD CONSTRAINT site_contact_fields_label_length_check CHECK (length(trim(label)) > 0 AND length(label) <= 255),
ADD CONSTRAINT site_contact_fields_value_length_check CHECK (length(trim(value)) > 0 AND length(value) <= 255);

ALTER TABLE public.admin_invite_codes
DROP CONSTRAINT IF EXISTS admin_invite_codes_label_length_check,
ADD CONSTRAINT admin_invite_codes_label_length_check CHECK (label IS NULL OR length(label) <= 255);

CREATE OR REPLACE FUNCTION public.submit_booking_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text := trim(coalesce(payload->>'name', ''));
  _contact text := trim(coalesce(payload->>'contact', ''));
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

REVOKE ALL ON FUNCTION public.submit_booking_request(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_booking_request(jsonb) TO service_role;

DROP POLICY IF EXISTS "Admins can upload event posters" ON storage.objects;
CREATE POLICY "Admins can upload event posters"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'event-posters'
  AND private.has_role(auth.uid(), 'admin'::public.app_role)
  AND lower(coalesce(metadata->>'mimetype', '')) LIKE 'image/%'
  AND coalesce(metadata->>'size', '') ~ '^[0-9]+$'
  AND (metadata->>'size')::bigint <= 5242880
);

DROP POLICY IF EXISTS "Admins can update event posters" ON storage.objects;
CREATE POLICY "Admins can update event posters"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'event-posters'
  AND private.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  bucket_id = 'event-posters'
  AND private.has_role(auth.uid(), 'admin'::public.app_role)
  AND lower(coalesce(metadata->>'mimetype', '')) LIKE 'image/%'
  AND coalesce(metadata->>'size', '') ~ '^[0-9]+$'
  AND (metadata->>'size')::bigint <= 5242880
);

DROP POLICY IF EXISTS "Admins can upload backline documents" ON storage.objects;
CREATE POLICY "Admins can upload backline documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'backline-documents'
  AND private.has_role(auth.uid(), 'admin'::public.app_role)
  AND coalesce(metadata->>'size', '') ~ '^[0-9]+$'
  AND (
    (lower(coalesce(metadata->>'mimetype', '')) = 'application/pdf' AND (metadata->>'size')::bigint <= 10485760)
    OR
    (lower(coalesce(metadata->>'mimetype', '')) LIKE 'image/%' AND (metadata->>'size')::bigint <= 5242880)
  )
);

DROP POLICY IF EXISTS "Admins can update backline documents" ON storage.objects;
CREATE POLICY "Admins can update backline documents"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'backline-documents'
  AND private.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  bucket_id = 'backline-documents'
  AND private.has_role(auth.uid(), 'admin'::public.app_role)
  AND coalesce(metadata->>'size', '') ~ '^[0-9]+$'
  AND (
    (lower(coalesce(metadata->>'mimetype', '')) = 'application/pdf' AND (metadata->>'size')::bigint <= 10485760)
    OR
    (lower(coalesce(metadata->>'mimetype', '')) LIKE 'image/%' AND (metadata->>'size')::bigint <= 5242880)
  )
);
