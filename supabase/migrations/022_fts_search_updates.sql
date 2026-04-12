-- 022_fts_search_updates.sql
--
-- Additive enhancements to the search layer introduced in migration 021:
--
-- 1. GIN full-text search indexes on events.title and event_updates content.
--    These complement the idx_events_title_lower functional index from 021
--    (which supports ILIKE prefix scans). The GIN indexes enable
--    websearch_to_tsquery-based FTS for complex queries without leading
--    wildcards, which benefits large datasets and multi-word queries.
--
-- 2. search_event_updates() RPC — finds event_updates by content and
--    source_name using the same websearch_to_tsquery approach. Useful for
--    finding specific articles, sources, or quotes by keyword.
--
-- DESIGN NOTES:
--
-- - CREATE INDEX IF NOT EXISTS: safe to run multiple times; a no-op if
--   already applied.
--
-- - websearch_to_tsquery: user-input-safe (handles unbalanced quotes, boolean
--   operators, stop words). Returns NULL for all-stop-word inputs — the WHERE
--   clause guards against NULL to return an empty set rather than an error.
--
-- - SECURITY INVOKER: RLS on event_updates applies automatically.
--
-- - Both migration 021's search_events(text,integer) and this migration's
--   search_event_updates(text) are SECURITY INVOKER and work for both anon
--   and authenticated callers (same visibility as the underlying tables).


-- ── GIN index on events.title ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_events_fts
  ON public.events
  USING GIN (to_tsvector('english', coalesce(title, '')));


-- ── GIN index on event_updates (content + source_name) ───────────────────

CREATE INDEX IF NOT EXISTS idx_event_updates_fts
  ON public.event_updates
  USING GIN (
    to_tsvector('english',
      coalesce(content, '') || ' ' || coalesce(source_name, '')
    )
  );


-- ── search_event_updates RPC ──────────────────────────────────────────────
--
-- Full-text search over event_updates by content and source_name.
-- Ranked by text relevance (ts_rank), newest first within the same rank tier.

CREATE OR REPLACE FUNCTION public.search_event_updates(query TEXT)
RETURNS SETOF public.event_updates
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT *
  FROM public.event_updates
  WHERE
    query IS NOT NULL
    AND query <> ''
    AND websearch_to_tsquery('english', query) IS NOT NULL
    AND to_tsvector('english',
          coalesce(content, '') || ' ' || coalesce(source_name, '')
        )
        @@ websearch_to_tsquery('english', query)
  ORDER BY
    ts_rank(
      to_tsvector('english',
        coalesce(content, '') || ' ' || coalesce(source_name, '')
      ),
      websearch_to_tsquery('english', query)
    ) DESC,
    created_at DESC
  LIMIT 50;
$$;
