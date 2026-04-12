-- 021_search_events.sql
--
-- Title-level functional index + search_events RPC.
--
-- Search strategy (MVP):
--   Primary match:  title ILIKE '%query%'  (case-insensitive substring)
--   Secondary match: EXISTS subquery on event_updates content/source_name
--
-- Ranking: title matches rank above content-only matches.
-- Within each rank bucket, newest events appear first.
--
-- Known limitation: ILIKE '%query%' with leading wildcard requires a sequential
-- scan on event_updates and does not use the title lower-index for non-prefix
-- queries. The idx_events_title_lower index below helps prefix scans on title
-- only. For production scale, pg_trgm or full-text search (tsvector) would be
-- needed. Acceptable for MVP event counts.
--
-- SECURITY INVOKER: runs as calling role; RLS on events + event_updates applies.
-- STABLE: no side effects.

-- Lower-case functional index on title for prefix search performance
CREATE INDEX IF NOT EXISTS idx_events_title_lower
  ON public.events (lower(title));

CREATE OR REPLACE FUNCTION public.search_events(
  p_query TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF public.events
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_pattern TEXT;
BEGIN
  -- Require at least 2 non-space characters to avoid scanning on single chars
  IF length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION 'search query must be at least 2 characters';
  END IF;

  v_pattern := '%' || lower(trim(p_query)) || '%';

  RETURN QUERY
  SELECT e.*
  FROM public.events e
  WHERE
    lower(e.title) LIKE v_pattern
    OR EXISTS (
      SELECT 1
      FROM public.event_updates u
      WHERE u.event_id = e.id
        AND (
          lower(u.content)     LIKE v_pattern
          OR lower(u.source_name) LIKE v_pattern
        )
    )
  ORDER BY
    -- Title matches rank higher than content-only matches
    CASE WHEN lower(e.title) LIKE v_pattern THEN 0 ELSE 1 END,
    e.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END;
$$;

-- No REVOKE: same visibility as events table (public read).
