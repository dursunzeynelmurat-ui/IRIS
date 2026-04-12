-- 020_get_rising_events.sql
--
-- Public read-only RPC for the Rising feed.
--
-- Design goals:
--   1. Follow-count is the primary signal — an event that many users are
--      watching is inherently more "rising" than one that has high trust but
--      no audience.
--   2. Status adds a secondary bonus: developing > emerging because it means
--      the story has already grown beyond a first report.
--   3. Trust score adds a tertiary tie-breaker so two equally-followed
--      events of the same status sort by credibility last.
--   4. Only emerging and developing events appear — verified/disputed are
--      resolved stories, not "rising" stories.
--
-- Rising score formula:
--   (follow_count * 10) + status_bonus + (trust_score / 10)
--   where status_bonus: developing = 20, emerging = 10
--
-- The multiplier and bonuses are intentionally unequal to ensure follow_count
-- dominates at any realistic scale (e.g. 1 follower → +10 pts, which exceeds
-- the max status+trust bonus of 30 pts only when follow_count ≥ 4).
--
-- SECURITY INVOKER (default): runs as the calling role, so RLS on events
-- applies. Anon users can read events (SELECT permissive policy exists from
-- migration 001); this function therefore works for both anon and authenticated.
--
-- STABLE: result depends only on DB state (no side effects), allowing
-- the planner to avoid repeated calls within the same statement.

CREATE OR REPLACE FUNCTION public.get_rising_events(
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF public.events
LANGUAGE sql
STABLE
AS $$
  SELECT e.*
  FROM public.events e
  WHERE e.status IN ('emerging', 'developing')
  ORDER BY
    (e.follow_count * 10)
    + CASE e.status WHEN 'developing' THEN 20 ELSE 10 END
    + (e.trust_score / 10)
    DESC,
    e.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

-- No REVOKE: this function is intentionally public (same visibility as the
-- events table itself). Internal mutation functions (ingest_event, etc.) have
-- explicit REVOKE FROM anon, authenticated in their own migrations.
