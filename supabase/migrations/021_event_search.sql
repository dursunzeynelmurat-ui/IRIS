-- 021_event_search.sql
--
-- Adds full-text search over events (by title) and event_updates (by content
-- + source_name). Uses expression GIN indexes — no stored tsvector columns.
--
-- DESIGN DECISIONS:
--
-- 1. Expression indexes (not stored columns).
--    Adding a stored tsvector column would pollute SELECT * results returned
--    by the existing ingest and query paths. Expression indexes give the same
--    query performance without changing the table schema or any existing types.
--
-- 2. websearch_to_tsquery for user input.
--    Safely handles unbalanced quotes, boolean operators, stop words, and
--    arbitrary user strings without requiring sanitization on the client.
--    websearch_to_tsquery returns NULL for inputs that produce an empty query
--    (all stop words, empty string) — the CASE guard below converts those to
--    an empty result set instead of a syntax error.
--
-- 3. Ranking: ts_rank on the tsvector expression. Documents with more/denser
--    matches sort higher. Trust score is used as a secondary sort within the
--    same rank tier for event search.
--
-- 4. LIMIT 50 on both functions. Search results are meant for interactive
--    query-as-you-type UI; returning more than 50 results is rarely useful and
--    keeps latency low.
--
-- 5. SECURITY INVOKER: existing RLS policies on events and event_updates apply.
--    No user-controlled identifiers are interpolated into SQL — the query text
--    goes through websearch_to_tsquery which is injection-safe by design.


-- ── GIN index on events.title ─────────────────────────────────────────────

CREATE INDEX idx_events_fts
  ON public.events
  USING GIN (to_tsvector('english', coalesce(title, '')));


-- ── GIN index on event_updates (content + source_name) ───────────────────

CREATE INDEX idx_event_updates_fts
  ON public.event_updates
  USING GIN (
    to_tsvector('english',
      coalesce(content, '') || ' ' || coalesce(source_name, '')
    )
  );


-- ── search_events RPC ─────────────────────────────────────────────────────
--
-- Full-text search over events by title.
-- Returns events ranked by text relevance, then trust_score.

CREATE OR REPLACE FUNCTION public.search_events(query TEXT)
RETURNS SETOF public.events
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT *
  FROM public.events
  WHERE
    query IS NOT NULL
    AND query <> ''
    AND websearch_to_tsquery('english', query) IS NOT NULL
    AND to_tsvector('english', coalesce(title, ''))
        @@ websearch_to_tsquery('english', query)
  ORDER BY
    ts_rank(
      to_tsvector('english', coalesce(title, '')),
      websearch_to_tsquery('english', query)
    ) DESC,
    trust_score DESC
  LIMIT 50;
$$;


-- ── search_event_updates RPC ──────────────────────────────────────────────
--
-- Full-text search over event_updates by content and source_name.
-- Useful for finding specific updates, articles, or sources by keyword.

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
    ) DESC
  LIMIT 50;
$$;
