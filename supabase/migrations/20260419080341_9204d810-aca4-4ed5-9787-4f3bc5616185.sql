
CREATE TABLE public.reminder_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  hours_before INTEGER NOT NULL DEFAULT 24,
  confirmed BOOLEAN NOT NULL DEFAULT true,
  unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);

ALTER TABLE public.reminder_subscriptions ENABLE ROW LEVEL SECURITY;

-- Anyone can sign up
CREATE POLICY "Anyone can subscribe"
ON public.reminder_subscriptions
FOR INSERT
WITH CHECK (true);

-- Admins can view all
CREATE POLICY "Admins view all subscriptions"
ON public.reminder_subscriptions
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins manage
CREATE POLICY "Admins manage subscriptions"
ON public.reminder_subscriptions
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_reminder_subscriptions_updated_at
BEFORE UPDATE ON public.reminder_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_reminder_subs_confirmed ON public.reminder_subscriptions(confirmed) WHERE confirmed = true;
