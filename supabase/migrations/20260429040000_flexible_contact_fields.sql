-- Flexible Contact Us card fields.
-- Keeps site_contacts as contact cards and moves individual values into site_contact_fields.

CREATE TABLE public.site_contact_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.site_contacts(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0 AND length(label) <= 80),
  value TEXT NOT NULL CHECK (length(trim(value)) > 0 AND length(value) <= 500),
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'link')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_contact_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active site contact fields"
ON public.site_contact_fields
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.site_contacts c
    WHERE c.id = site_contact_fields.contact_id
      AND (c.active = true OR public.has_role(auth.uid(), 'admin'::public.app_role))
  )
);

CREATE POLICY "Admins can insert site contact fields"
ON public.site_contact_fields
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update site contact fields"
ON public.site_contact_fields
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete site contact fields"
ON public.site_contact_fields
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_site_contact_fields_updated_at
BEFORE UPDATE ON public.site_contact_fields
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.site_contact_fields (contact_id, label, value, field_type, sort_order)
SELECT id, 'Email', email, 'link', 10
FROM public.site_contacts
WHERE email IS NOT NULL AND length(trim(email)) > 0;

INSERT INTO public.site_contact_fields (contact_id, label, value, field_type, sort_order)
SELECT id, 'Telegram', 'https://t.me/' || regexp_replace(telegram, '^@', ''), 'link', 20
FROM public.site_contacts
WHERE telegram IS NOT NULL AND length(trim(telegram)) > 0;

INSERT INTO public.site_contact_fields (contact_id, label, value, field_type, sort_order)
SELECT id, 'Mobile', 'tel:' || regexp_replace(mobile, '[^0-9+]', '', 'g'), 'link', 30
FROM public.site_contacts
WHERE mobile IS NOT NULL AND length(trim(mobile)) > 0;

ALTER TABLE public.site_contacts
DROP CONSTRAINT IF EXISTS site_contacts_check,
DROP COLUMN IF EXISTS contact_type,
DROP COLUMN IF EXISTS email,
DROP COLUMN IF EXISTS telegram,
DROP COLUMN IF EXISTS mobile;

ALTER PUBLICATION supabase_realtime ADD TABLE public.site_contact_fields;
