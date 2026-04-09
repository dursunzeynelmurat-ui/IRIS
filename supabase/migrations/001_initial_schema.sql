-- ============================================================
-- IRIS — Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================


-- ============================================================
-- TABLE: public.users
-- Public profile linked to Supabase auth.users via trigger.
-- email is nullable: auth providers may not expose it.
-- ============================================================
CREATE TABLE public.users (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- TABLE: public.events
-- Core entity. status uses CHECK (not enum) for easy extension.
-- trust_score defaults to 50 (neutral / unknown).
-- source_count is denormalized for query performance;
--   kept in sync by trigger on event_updates.
-- ============================================================
CREATE TABLE public.events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'emerging'
                           CHECK (status IN ('emerging', 'developing', 'verified', 'disputed')),
  trust_score  INTEGER     NOT NULL DEFAULT 50
                           CHECK (trust_score >= 0 AND trust_score <= 100),
  source_count INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_status        ON public.events(status);
CREATE INDEX idx_events_created_at    ON public.events(created_at DESC);
CREATE INDEX idx_events_trust_score   ON public.events(trust_score DESC);
CREATE INDEX idx_events_status_created ON public.events(status, created_at DESC);


-- ============================================================
-- TABLE: public.event_updates
-- Timeline entries for an event. source_url is nullable
--   (not all sources have a URL, e.g. radio, HUMINT).
-- Cascade delete: removing an event removes all its updates.
-- ============================================================
CREATE TABLE public.event_updates (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  source_name TEXT        NOT NULL,
  source_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_updates_event_id   ON public.event_updates(event_id);
CREATE INDEX idx_event_updates_created_at ON public.event_updates(event_id, created_at DESC);


-- ============================================================
-- TABLE: public.signals
-- User crowd-signals on events (confirm / dispute).
-- UNIQUE(user_id, event_id): one active signal per user per event.
--   To change signal type, use ON CONFLICT DO UPDATE (upsert).
-- References auth.users directly — auth is the source of truth.
-- ============================================================
CREATE TABLE public.signals (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL CHECK (type IN ('confirm', 'dispute')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX idx_signals_event_id ON public.signals(event_id);
CREATE INDEX idx_signals_user_id  ON public.signals(user_id);


-- ============================================================
-- TRIGGER: auto-populate public.users on auth signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- TRIGGER: keep events.source_count in sync with event_updates
-- ============================================================
CREATE OR REPLACE FUNCTION increment_source_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.events
  SET source_count = source_count + 1
  WHERE id = NEW.event_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_increment_source_count
AFTER INSERT ON public.event_updates
FOR EACH ROW EXECUTE FUNCTION increment_source_count();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals       ENABLE ROW LEVEL SECURITY;

-- users: own profile only
CREATE POLICY "users_read_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- events: public read
CREATE POLICY "events_read_all"
  ON public.events FOR SELECT
  USING (true);

-- event_updates: public read, authenticated insert
CREATE POLICY "event_updates_read_all"
  ON public.event_updates FOR SELECT
  USING (true);

CREATE POLICY "event_updates_insert_auth"
  ON public.event_updates FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- signals: own signals only
CREATE POLICY "signals_read_own"
  ON public.signals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "signals_insert_own"
  ON public.signals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "signals_update_own"
  ON public.signals FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "signals_delete_own"
  ON public.signals FOR DELETE
  USING (auth.uid() = user_id);
