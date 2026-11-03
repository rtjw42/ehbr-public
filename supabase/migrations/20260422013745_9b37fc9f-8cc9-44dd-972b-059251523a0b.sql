-- Events table
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE,
  poster_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view events"
ON public.events FOR SELECT
USING (true);

CREATE POLICY "Admins can insert events"
ON public.events FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update events"
ON public.events FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete events"
ON public.events FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_events_updated_at
BEFORE UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_events_event_date ON public.events(event_date);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;

-- Storage bucket for posters
INSERT INTO storage.buckets (id, name, public) VALUES ('event-posters', 'event-posters', true);

CREATE POLICY "Event posters are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'event-posters');

CREATE POLICY "Admins can upload event posters"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'event-posters' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update event posters"
ON storage.objects FOR UPDATE
USING (bucket_id = 'event-posters' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete event posters"
ON storage.objects FOR DELETE
USING (bucket_id = 'event-posters' AND has_role(auth.uid(), 'admin'::app_role));