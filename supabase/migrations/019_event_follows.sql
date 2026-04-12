-- 019_event_follows.sql
--
-- Adds user-to-event follows. The follow count drives the Rising feed
-- (see migration 020). Architecture mirrors the source_count/signals pattern:
-- a denormalized counter on events kept in sync by an AFTER INSERT OR DELETE
-- trigger so the Rising feed query is a fast indexed sort rather than a
-- live COUNT(*) subquery.
--
-- ── Table ─────────────────────────────────────────────────────────────────

CREATE TABLE public.event_follows (
  user_id    UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  event_id   UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);

-- Efficient look-up of all followers for an event (used by trigger + queries)
CREATE INDEX idx_event_follows_event_id ON public.event_follows (event_id);
-- Efficient look-up of all events a user follows (for profile / future feed)
CREATE INDEX idx_event_follows_user_id  ON public.event_follows (user_id);

-- ── Denormalized counter on events ────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN follow_count INTEGER NOT NULL DEFAULT 0;

-- Descending index supports ORDER BY follow_count DESC in Rising query
CREATE INDEX idx_events_follow_count ON public.events (follow_count DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.event_follows ENABLE ROW LEVEL SECURITY;

-- Permissive policies (authenticated users only)
CREATE POLICY follows_read_own
  ON public.event_follows FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY follows_insert_own
  ON public.event_follows FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Permissive DELETE — unlike signals, follows are intentionally reversible.
-- deny_follows_update (below) blocks the UPDATE path to prevent row hijacking.
CREATE POLICY follows_delete_own
  ON public.event_follows FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RESTRICTIVE: block anon completely (no leaking follow state)
CREATE POLICY deny_follows_anon
  ON public.event_follows AS RESTRICTIVE FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- RESTRICTIVE: block UPDATE for authenticated users — follow rows are
-- insert/delete only; an UPDATE could reassign user_id or event_id.
CREATE POLICY deny_follows_update
  ON public.event_follows AS RESTRICTIVE FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

-- ── Trigger: keep follow_count in sync ────────────────────────────────────
--
-- SECURITY DEFINER + SET search_path = public: prevents search-path injection
-- and ensures the UPDATE on events.follow_count succeeds even if the
-- deny_events_update RESTRICTIVE policy is in effect for the calling role.
-- (Same pattern as sync_source_count in migration 008.)

CREATE OR REPLACE FUNCTION public.sync_follow_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events
    SET follow_count = follow_count + 1
    WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events
    SET follow_count = GREATEST(follow_count - 1, 0)
    WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_follow_count
  AFTER INSERT OR DELETE ON public.event_follows
  FOR EACH ROW EXECUTE FUNCTION public.sync_follow_count();
