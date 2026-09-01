DROP FUNCTION IF EXISTS public.claim_admin_invite(text);
DROP FUNCTION IF EXISTS public.is_master_admin();
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.reject_booking(uuid);

CREATE OR REPLACE FUNCTION public.upsert_contact_fields(_contact_id uuid, _fields jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, private
AS $$
DECLARE
  _field jsonb;
  _field_count integer;
  _index integer := 0;
  _field_id uuid;
  _stored_id uuid;
  _label text;
  _value text;
  _field_type text;
  _sort_order integer;
  _kept_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin access is required';
  END IF;

  IF _contact_id IS NULL THEN
    RAISE EXCEPTION 'Contact id is required';
  END IF;

  IF jsonb_typeof(_fields) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Contact fields must be an array';
  END IF;

  _field_count := jsonb_array_length(_fields);
  IF _field_count = 0 THEN
    RAISE EXCEPTION 'At least one contact field is required';
  END IF;
  IF _field_count > 5 THEN
    RAISE EXCEPTION 'No more than 5 contact fields are allowed';
  END IF;

  PERFORM 1 FROM public.site_contacts WHERE id = _contact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  FOR _field IN SELECT value FROM jsonb_array_elements(_fields)
  LOOP
    _index := _index + 1;
    _field_id := NULL;
    _stored_id := NULL;
    _label := btrim(coalesce(_field->>'label', ''));
    _value := btrim(coalesce(_field->>'value', ''));
    _field_type := btrim(coalesce(nullif(_field->>'field_type', ''), 'text'));
    _sort_order := coalesce(nullif(_field->>'sort_order', '')::integer, _index * 10);

    IF coalesce(_field->>'id', '') <> '' THEN
      _field_id := (_field->>'id')::uuid;
    END IF;

    IF length(_label) = 0 OR length(_label) > 255 THEN
      RAISE EXCEPTION 'Contact field label must be between 1 and 255 characters';
    END IF;
    IF length(_value) = 0 OR length(_value) > 255 THEN
      RAISE EXCEPTION 'Contact field value must be between 1 and 255 characters';
    END IF;
    IF _field_type NOT IN ('text', 'link', 'instagram', 'telegram', 'email', 'phone', 'whatsapp') THEN
      RAISE EXCEPTION 'Invalid contact field type';
    END IF;

    IF _field_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.site_contact_fields
      WHERE id = _field_id
        AND contact_id <> _contact_id
    ) THEN
      RAISE EXCEPTION 'Invalid contact field id';
    END IF;

    IF _field_id IS NOT NULL THEN
      UPDATE public.site_contact_fields
      SET label = _label,
          value = _value,
          field_type = _field_type,
          sort_order = _sort_order
      WHERE id = _field_id
        AND contact_id = _contact_id
      RETURNING id INTO _stored_id;
    END IF;

    IF _stored_id IS NULL THEN
      INSERT INTO public.site_contact_fields (id, contact_id, label, value, field_type, sort_order)
      VALUES (coalesce(_field_id, gen_random_uuid()), _contact_id, _label, _value, _field_type, _sort_order)
      RETURNING id INTO _stored_id;
    END IF;

    _kept_ids := array_append(_kept_ids, _stored_id);
  END LOOP;

  DELETE FROM public.site_contact_fields
  WHERE contact_id = _contact_id
    AND NOT (id = ANY(_kept_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_contact_fields(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_contact_fields(uuid, jsonb) TO authenticated;
