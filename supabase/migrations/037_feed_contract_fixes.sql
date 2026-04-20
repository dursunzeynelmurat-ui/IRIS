-- 037_feed_contract_fixes.sql
--
-- Closes three gaps identified in the finalization audit:
--
-- 1. get_feed_events — add official_confirmation + conflict_flag to all modes.
--    EventCard in src/types/index.ts declares both fields; the function was
--    returning 13 columns while the TypeScript interface expected 15.
--
-- 2. get_feed_events 'new' mode — add status exclusion filter.
--    'new' was returning archived/resolved/contained events (only filtered on
--    visibility='visible'). These lifecycle-terminal statuses should never
--    appear in the main feed regardless of visibility state.
--
-- 3. get_rising_events — delegate to get_feed_events instead of duplicating
--    its logic. The standalone function was a copy-paste of the 'rising' branch
--    that had already drifted (missing the same official_confirmation gap) and
--    would continue to drift on future changes.


-- ── 1 + 2: Replace get_feed_events ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_feed_events(TEXT, INTEGER, INTEGER);

CREATE FUNCTION public.get_feed_events(
  p_mode   TEXT    DEFAULT 'new',
  p_limit  INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id                    UUID,
  title                 TEXT,
  image_url             TEXT,
  summary               TEXT,
  status                TEXT,
  trust_score           INTEGER,
  importance_score      INTEGER,
  feed_rank             NUMERIC,
  source_count          INTEGER,
  update_count          INTEGER,
  follow_count          INTEGER,
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
  v_limit  INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF p_mode NOT IN ('new', 'verified', 'rising') THEN
    RAISE EXCEPTION
      'get_feed_events: invalid mode "%". Valid values: new, verified, rising', p_mode;
  END IF;

  IF p_mode = 'rising' THEN
    RETURN QUERY
      SELECT e.id, e.title, e.image_url, e.summary, e.status,
             e.trust_score, e.importance_score, e.feed_rank,
             e.source_count, e.update_count, e.follow_count,
             e.official_confirmation, e.conflict_flag,
             e.latest_update_at, e.created_at
      FROM public.events e
      WHERE e.status IN ('new', 'developing')
        AND e.visibility = 'visible'
      ORDER BY e.feed_rank DESC, COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit OFFSET v_offset;

  ELSIF p_mode = 'verified' THEN
    RETURN QUERY
      SELECT e.id, e.title, e.image_url, e.summary, e.status,
             e.trust_score, e.importance_score, e.feed_rank,
             e.source_count, e.update_count, e.follow_count,
             e.official_confirmation, e.conflict_flag,
             e.latest_update_at, e.created_at
      FROM public.events e
      WHERE e.status = 'verified'
        AND e.visibility = 'visible'
      ORDER BY e.feed_rank DESC, COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit OFFSET v_offset;

  ELSE
    -- 'new': active events only — exclude lifecycle-terminal statuses.
    -- visibility='visible' is necessary but not sufficient: an archived event
    -- can briefly have visibility='visible' while the async pipeline catches up.
    RETURN QUERY
      SELECT e.id, e.title, e.image_url, e.summary, e.status,
             e.trust_score, e.importance_score, e.feed_rank,
             e.source_count, e.update_count, e.follow_count,
             e.official_confirmation, e.conflict_flag,
             e.latest_update_at, e.created_at
      FROM public.events e
      WHERE e.visibility = 'visible'
        AND e.status NOT IN ('archived', 'resolved', 'contained')
      ORDER BY COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit OFFSET v_offset;
  END IF;
END;
$$;


-- ── 3: Replace get_rising_events — delegate, don't duplicate ─────────────────

DROP FUNCTION IF EXISTS public.get_rising_events(INTEGER);

CREATE FUNCTION public.get_rising_events(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id                    UUID,
  title                 TEXT,
  image_url             TEXT,
  summary               TEXT,
  status                TEXT,
  trust_score           INTEGER,
  importance_score      INTEGER,
  feed_rank             NUMERIC,
  source_count          INTEGER,
  update_count          INTEGER,
  follow_count          INTEGER,
  official_confirmation BOOLEAN,
  conflict_flag         BOOLEAN,
  latest_update_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.get_feed_events(
    'rising',
    GREATEST(1, LEAST(COALESCE(p_limit, 20), 100)),
    0
  );
$$;
