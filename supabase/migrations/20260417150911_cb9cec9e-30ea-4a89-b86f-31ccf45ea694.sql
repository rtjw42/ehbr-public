-- Roles enum + table
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins view all roles" ON public.user_roles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Status enum
CREATE TYPE public.booking_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.recurrence_type AS ENUM ('none', 'daily', 'weekly', 'monthly');

-- Booking groups (for recurring series)
CREATE TABLE public.booking_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurrence public.recurrence_type NOT NULL DEFAULT 'none',
  recurrence_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read booking groups" ON public.booking_groups FOR SELECT USING (true);
CREATE POLICY "Anyone can insert booking groups" ON public.booking_groups FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins manage booking groups" ON public.booking_groups
  FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Bookings
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.booking_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  color_r INT NOT NULL DEFAULT 200 CHECK (color_r BETWEEN 0 AND 255),
  color_g INT NOT NULL DEFAULT 180 CHECK (color_g BETWEEN 0 AND 255),
  color_b INT NOT NULL DEFAULT 140 CHECK (color_b BETWEEN 0 AND 255),
  status public.booking_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (length(trim(name)) > 0 AND length(name) <= 100),
  CHECK (length(trim(contact)) > 0 AND length(contact) <= 100)
);
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_bookings_start ON public.bookings(start_time);
CREATE INDEX idx_bookings_status ON public.bookings(status);

-- Public can see only approved
CREATE POLICY "Anyone can view approved bookings" ON public.bookings
  FOR SELECT USING (status = 'approved');
CREATE POLICY "Admins view all bookings" ON public.bookings
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Anyone can request a booking" ON public.bookings
  FOR INSERT WITH CHECK (status = 'pending');
CREATE POLICY "Admins update bookings" ON public.bookings
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete bookings" ON public.bookings
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Admin seed trigger: grant 'admin' to seeded email on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email = 'rtjw42@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();