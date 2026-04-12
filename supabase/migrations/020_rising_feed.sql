-- 020_rising_feed.sql
--
-- Adds get_rising_events() RPC for the Rising feed tab.
--
-- DESIGN DECISIONS:
--
-- 1. Rising = events that are gaining community attention but are not yet
--    verified. Filtered to status IN ('emerging', 'developing') — verified
--    and disputed events belong to the main Verified feed.
--
-- 2. Ordering: follow_count DESC, trust_score DESC, created_at DESC.
--    follow_count is the primary momentum signal (migration 019).
--    trust_score breaks ties among events with equal follow counts.
--    created_at is the final tiebreaker (newer events surface first).
--
-- 3. LIMIT 100 keeps the response payload bounded. The client paginates
--    visually; server-side cursor pagination is out of scope for v1.
--
-- 4. RETURNS SETOF public.events returns the full row — same shape as the
--    main events table SELECT, so the client can use the same Event type
--    from src/types/index.ts without a separate interface.
--
-- 5. SECURITY INVOKER: runs as the calling user, so the existing RLS
--    policies on public.events apply automatically. No BYPASSRLS risk.
--    No SET search_path needed (no user-controlled input, no schema
--    resolution ambiguity — the function body uses fully qualified names).


CREATE OR REPLACE FUNCTION public.get_rising_events()
RETURNS SETOF public.events
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT *
  FROM public.events
  WHERE status IN ('emerging', 'developing')
  ORDER BY follow_count DESC, trust_score DESC, created_at DESC
  LIMIT 100;
$$;
