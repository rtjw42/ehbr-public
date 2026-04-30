-- Editable Backline content cards and public Contact Us entries.

CREATE TABLE public.backline_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL UNIQUE CHECK (section_key IN ('gear', 'rates')),
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('pdf', 'image', 'text')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 120),
  body_text TEXT,
  file_path TEXT,
  file_name TEXT,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (content_type = 'text' AND body_text IS NOT NULL AND length(trim(body_text)) > 0)
    OR
    (content_type IN ('pdf', 'image') AND file_path IS NOT NULL AND length(trim(file_path)) > 0)
  )
);

ALTER TABLE public.backline_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view backline content"
ON public.backline_content
FOR SELECT
USING (true);

CREATE POLICY "Admins can insert backline content"
ON public.backline_content
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update backline content"
ON public.backline_content
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete backline content"
ON public.backline_content
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_backline_content_updated_at
BEFORE UPDATE ON public.backline_content
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.site_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0 AND length(label) <= 120),
  contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'telegram', 'mobile', 'telegram_mobile')),
  email TEXT,
  telegram TEXT,
  mobile TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (contact_type = 'email' AND email IS NOT NULL AND length(trim(email)) > 0)
    OR
    (contact_type = 'telegram' AND telegram IS NOT NULL AND length(trim(telegram)) > 0)
    OR
    (contact_type = 'mobile' AND mobile IS NOT NULL AND length(trim(mobile)) > 0)
    OR
    (
      contact_type = 'telegram_mobile'
      AND telegram IS NOT NULL AND length(trim(telegram)) > 0
      AND mobile IS NOT NULL AND length(trim(mobile)) > 0
    )
  )
);

ALTER TABLE public.site_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active site contacts"
ON public.site_contacts
FOR SELECT
USING (active = true OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can insert site contacts"
ON public.site_contacts
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update site contacts"
ON public.site_contacts
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete site contacts"
ON public.site_contacts
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_site_contacts_updated_at
BEFORE UPDATE ON public.site_contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_site_contacts_sort ON public.site_contacts(active, sort_order, label);

ALTER PUBLICATION supabase_realtime ADD TABLE public.backline_content;
ALTER PUBLICATION supabase_realtime ADD TABLE public.site_contacts;

INSERT INTO public.backline_content (section_key, content_type, title, body_text)
VALUES
  ('gear', 'text', 'Gear', 'Upload the latest gear list as text, image, or PDF.'),
  ('rates', 'text', 'Rates', 'Upload the latest rates as text, image, or PDF.')
ON CONFLICT (section_key) DO NOTHING;

INSERT INTO public.site_contacts (label, contact_type, email, telegram, sort_order)
VALUES
  ('Ryan', 'email', 'ryantjw3@gmail.com', NULL, 10),
  ('Ryan', 'telegram', NULL, '@ryantjw3', 20)
ON CONFLICT DO NOTHING;
