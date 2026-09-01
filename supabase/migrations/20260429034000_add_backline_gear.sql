-- Backline gear catalog and public equipment-list PDF storage.

CREATE TABLE public.backline_gear (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 120),
  category TEXT NOT NULL CHECK (length(trim(category)) > 0 AND length(category) <= 80),
  condition TEXT NOT NULL CHECK (length(trim(condition)) > 0 AND length(condition) <= 120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.backline_gear ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view backline gear"
ON public.backline_gear
FOR SELECT
USING (true);

CREATE POLICY "Admins can insert backline gear"
ON public.backline_gear
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update backline gear"
ON public.backline_gear
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete backline gear"
ON public.backline_gear
FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_backline_gear_updated_at
BEFORE UPDATE ON public.backline_gear
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_backline_gear_sort ON public.backline_gear(sort_order, name);

ALTER PUBLICATION supabase_realtime ADD TABLE public.backline_gear;

INSERT INTO storage.buckets (id, name, public)
VALUES ('backline-documents', 'backline-documents', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "Backline documents are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'backline-documents');

CREATE POLICY "Admins can upload backline documents"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'backline-documents' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update backline documents"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'backline-documents' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'backline-documents' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete backline documents"
ON storage.objects
FOR DELETE
USING (bucket_id = 'backline-documents' AND public.has_role(auth.uid(), 'admin'::public.app_role));
