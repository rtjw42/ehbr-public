-- Event Media & Setlist (Stage 1): per-event embedded media + typed setlist.
-- Two jsonb columns on `events`, no new table/storage/cron. Both default to an
-- empty array and are NOT NULL so the service/renderer always deal with an array,
-- never null. Structural CHECKs guarantee the array shape at the DB level; the
-- per-entry validation (provider allow-list, URL checks) lives in the service.
--
--   media   — entries { type: "youtube" | "photo_album", url, title? }
--   setlist — entries { title, spotify?, apple?, youtube? }
--
-- RLS is unchanged: events stay public-read; writes remain admin-only via the
-- existing policies. The columns are inert until the service starts using them.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS media jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS setlist jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_media_is_array,
  ADD CONSTRAINT events_media_is_array CHECK (jsonb_typeof(media) = 'array');

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_setlist_is_array,
  ADD CONSTRAINT events_setlist_is_array CHECK (jsonb_typeof(setlist) = 'array');
