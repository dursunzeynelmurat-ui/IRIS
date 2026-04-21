-- 036_source_policy_and_feed_fixes.sql
--
-- Targeted fixes for product-alignment and integration-risk issues.
--
-- 1. source_policy column on source_feeds
--    Three values control when a feed is eligible for production polling:
--
--      active_allowed    — open feed, no known licensing restriction.
--                          Seeded as is_active=true. Safe for production.
--
--      dev_only          — useful for development/testing; not appropriate
--                          for production (unofficial proxy, scraper, or
--                          terms that restrict commercial use at scale).
--                          Seeded as is_active=false; manually enable in dev.
--
--      licensed_required — source requires a formal license agreement before
--                          production polling. Seeded as is_active=false.
--                          Must be manually activated after license confirmed.
--
--    The getActiveFeeds() TypeScript function enforces the policy at runtime:
--      - licensed_required feeds are never polled even if is_active=true
--      - dev_only feeds are only polled when NODE_ENV != 'production'
--
-- 2. Backfill existing seeds:
--      reuters-world  → licensed_required (commercial API licensing required)
--      ap-world       → dev_only (uses rsshub.app proxy, unofficial scraper)
--      all others     → active_allowed (open official/media feeds)
--
-- 3. Disable licensed_required feeds (is_active = false)
--    Dev_only feeds keep their current is_active; the seed and poller manage
--    runtime gating rather than the DB state for dev feeds.
--
-- 4. search_events fix: exclude status='archived' events
--    Archived events have visibility removed from feed surfaces. They should
--    not appear in search results either. The previous search_events
--    (migration 035) only filtered on visibility='visible' but not on status.
--    A status='archived' event could still have visibility='visible' while
--    it is being transitioned (the async pipeline sets them separately).
--
-- 5. Index for policy-aware polling queries.


-- ── 1. Add source_policy column ───────────────────────────────────────────────

ALTER TABLE public.source_feeds
  ADD COLUMN source_policy TEXT NOT NULL DEFAULT 'active_allowed'
  CHECK (source_policy IN ('active_allowed', 'dev_only', 'licensed_required'));


-- ── 2. Backfill policies ──────────────────────────────────────────────────────

-- Reuters requires licensing for commercial aggregation/redistribution.
UPDATE public.source_feeds
  SET source_policy = 'licensed_required'
  WHERE slug = 'reuters-world';

-- AP News via rsshub.app is an unofficial community proxy scraping AP content.
-- Not suitable for production; safe for local development only.
UPDATE public.source_feeds
  SET source_policy = 'dev_only'
  WHERE slug = 'ap-world';

-- All other seeded feeds (BBC, Al Jazeera, DW, France24, WHO, USGS, GDACS,
-- ReliefWeb) are open or official feeds appropriate for production.
-- Their source_policy remains 'active_allowed' (the DEFAULT).


-- ── 3. Disable licensed_required feeds ───────────────────────────────────────
--
-- Force is_active=false for any feed requiring a license agreement.
-- This prevents accidental production polling before a license is in place.
-- A DBA must explicitly set is_active=true after confirming the license.

UPDATE public.source_feeds
  SET is_active = false
  WHERE source_policy = 'licensed_required';


-- ── 4. Index for policy-aware queries ────────────────────────────────────────

CREATE INDEX idx_source_feeds_policy
  ON public.source_feeds (source_policy, is_active)
  WHERE is_active = true;


-- ── 5. Fix search_events — exclude archived-status events ────────────────────
--
-- Adds status <> 'archived' filter alongside the existing visibility='visible'
-- filter. An event may have visibility='visible' while asynchronously being
-- transitioned to archived — this ensures neither reach search results.
--
-- Also restores the full function body because migration 035 dropped and
-- recreated it; this is a clean override of that version.

DROP FUNCTION IF EXISTS public.search_events(TEXT, INTEGER);

CREATE FUNCTION public.search_events(
  p_query TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id                    UUID,
  title                 TEXT,
  image_url             TEXT,
  summary               TEXT,
  status                TEXT,
  trust_score           INTEGER,
  importance_score      INTEGER,
  feed_rank             NUMERIC(8,4),
  source_count          INTEGER,
  follow_count          INTEGER,
  update_count          INTEGER,
  official_confirmation BOOLEAN,
  conflict_flag         BOOLEAN,
  latest_update_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pattern TEXT;
BEGIN
  IF length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION 'search query must be at least 2 characters';
  END IF;

  v_pattern := '%' || lower(trim(p_query)) || '%';

  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.image_url,
    e.summary,
    e.status,
    e.trust_score,
    e.importance_score,
    e.feed_rank,
    e.source_count,
    e.follow_count,
    e.update_count,
    e.official_confirmation,
    e.conflict_flag,
    e.latest_update_at,
    e.created_at
  FROM public.events e
  WHERE
    e.visibility = 'visible'
    AND e.status <> 'archived'
    AND (
      lower(e.title) LIKE v_pattern
      OR EXISTS (
        SELECT 1
        FROM public.event_updates u
        WHERE u.event_id = e.id
          AND u.is_visible = true
          AND (
            lower(u.content)        LIKE v_pattern
            OR lower(u.source_name) LIKE v_pattern
          )
      )
    )
  ORDER BY
    CASE WHEN lower(e.title) LIKE v_pattern THEN 0 ELSE 1 END,
    e.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;

-- No REVOKE: SECURITY INVOKER — public read like the events table itself.
