-- 019_event_follows.sql
--
-- Adds event follow/watch state so users can track events.
-- follow_count on events is the primary signal for the Rising feed.
--
-- DESIGN DECISIONS:
--
-- 1. follow_count is a denormalized counter on events (mirrors source_count
--    from migration 003). Maintained by sync_follow_count() trigger so reads
--    are always O(1) regardless of follow volume.
--
-- 2. event_follows has composite PK (user_id, event_id) — enforces one row
--    per (user, event) pair at the DB level. No unique index needed separately.
--
-- 3. toggle_event_follow() RPC provides atomic follow/unfollow:
--    checks current state, then either inserts or deletes. Returns 'followed'
--    or 'unfollowed' so the client can update local state without a round-trip
--    read after the mutation. SECURITY DEFINER so it can bypass RLS internally
--    while still enforcing the auth.uid() ownership check in the function body.
--
-- 4. UPDATE is denied via RESTRICTIVE policy. Users insert (follow) or delete
--    (unfollow); there is no meaningful UPDATE on this table.
--
-- 5. Anon is denied ALL access via RESTRICTIVE policy, consistent with
--    deny_signals_anon and deny_users_anon (migration 010).
--
-- 6. sync_follow_count() is SECURITY DEFINER + SET search_path = public so
--    the UPDATE on events.follow_count succeeds even when the
--    deny_events_update RESTRICTIVE policy is in effect (same pattern as
--    sync_source_count from migration 008).


-- ── event_follows table ───────────────────────────────────────────────────

CREATE TABLE public.event_follows (
  user_id    UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  event_id   UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);

-- Efficient lookup of all followers for an event
CREATE INDEX idx_event_follows_event_id ON public.event_follows (event_id);
-- Efficient lookup of all events a user follows
CREATE INDEX idx_event_follows_user_id  ON public.event_follows (user_id);


-- ── Add follow_count to events ────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN follow_count INTEGER NOT NULL DEFAULT 0
  CHECK (follow_count >= 0);

-- Descending composite index supports ORDER BY follow_count DESC, trust_score DESC
-- used in get_rising_events (migration 020).
CREATE INDEX idx_events_follow_count
  ON public.events (follow_count DESC, trust_score DESC);


-- ── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE public.event_follows ENABLE ROW LEVEL SECURITY;

-- RESTRICTIVE: anon cannot access this table at all.
CREATE POLICY "deny_follows_anon" ON public.event_follows
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- RESTRICTIVE: authenticated cannot UPDATE follows rows.
-- Rows are inserted (follow) or deleted (unfollow); an UPDATE could
-- reassign user_id or event_id to another user.
CREATE POLICY "deny_follows_update" ON public.event_follows
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

-- PERMISSIVE: authenticated can read their own follows
CREATE POLICY "follows_read_own" ON public.event_follows
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- PERMISSIVE: authenticated can follow (insert their own row)
CREATE POLICY "follows_insert_own" ON public.event_follows
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- PERMISSIVE: authenticated can unfollow (delete their own row)
CREATE POLICY "follows_delete_own" ON public.event_follows
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ── sync_follow_count trigger ─────────────────────────────────────────────
--
-- Mirrors sync_source_count() from migration 003/008.
-- SECURITY DEFINER + SET search_path: ensures the UPDATE on events.follow_count
-- succeeds regardless of the deny_events_update RESTRICTIVE policy.
-- GREATEST guard prevents follow_count going negative from concurrent deletes.

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


-- ── toggle_event_follow RPC ───────────────────────────────────────────────
--
-- Atomic follow/unfollow for a single event. Returns 'followed' or
-- 'unfollowed' so the client can update state without a subsequent SELECT.
--
-- SECURITY DEFINER: runs as the function owner (BYPASSRLS) so it can
-- read/write event_follows without the calling role's RLS context interfering.
-- Ownership is enforced in the function body via auth.uid().
--
-- ON CONFLICT DO NOTHING on INSERT: defensive against concurrent duplicate
-- calls (primary key would otherwise raise a unique violation).

CREATE OR REPLACE FUNCTION public.toggle_event_follow(p_event_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exists  BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_follows
    WHERE user_id = v_user_id AND event_id = p_event_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.event_follows
    WHERE user_id = v_user_id AND event_id = p_event_id;
    RETURN 'unfollowed';
  ELSE
    INSERT INTO public.event_follows (user_id, event_id)
    VALUES (v_user_id, p_event_id)
    ON CONFLICT (user_id, event_id) DO NOTHING;
    RETURN 'followed';
  END IF;
END;
$$;
