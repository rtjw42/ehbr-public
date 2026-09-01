ALTER TABLE public.site_contact_fields
DROP CONSTRAINT IF EXISTS site_contact_fields_field_type_check;

ALTER TABLE public.site_contact_fields
ADD CONSTRAINT site_contact_fields_field_type_check
CHECK (field_type IN ('text', 'link', 'instagram', 'telegram', 'email', 'phone', 'whatsapp'));
