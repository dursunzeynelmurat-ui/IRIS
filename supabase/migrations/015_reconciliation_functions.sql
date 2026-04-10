-- 015_reconciliation_functions.sql
--
-- Admin-only reconciliation functions for repairing denormalized counters
-- and trust scores that have drifted from the correct values.
--
-- WHEN WOULD DRIFT OCCUR?
--
--   source_count and trust_score are maintained by AFTER triggers on signals
--   and event_updates. PostgreSQL triggers fire for all row-level DML,
--   including from service_role. Normal operations do not produce drift.
--
--   Drift can occur from:
--     - TRUNCATE on event_updates or signals (not trapped by row triggers)
--     - ALTER TABLE ... DISABLE TRIGGER (explicit trigger bypass)
--     - Direct manual UPDATE on events.source_count or events.trust_score
--       from the Supabase SQL Editor or psql
--     - Bulk data migrations or restore operations that skip triggers
--
--   These functions provide a safe, atomic repair path for such scenarios.
--
-- ── reconcile_source_counts() ─────────────────────────────────────────────
--
--   Recomputes source_count for every event in one pass by counting the
--   actual event_updates rows. Updates only events where source_count is
--   wrong. Returns (event_id, old_count, new_count) for every row changed,
--   so the caller can log what was repaired.
--
-- ── reconcile_trust_scores() ──────────────────────────────────────────────
--
--   Recomputes trust_score for every event in one pass by counting confirm
--   and dispute signals. Uses the same scoring formula as
--   recalculate_trust_score(): ROUND(confirms / total * 100), clamped 0–100,
--   reset to 50 when total = 0. Updates only events where trust_score is
--   wrong. Returns (event_id, old_score, new_score) for every row changed.
--
--   NOTE: does NOT acquire per-event FOR UPDATE locks (unlike
--   recalculate_trust_score). This function is intended for offline repair
--   or maintenance windows. Do not run concurrently with active signalling.
--
-- ACCESS: REVOKE from PUBLIC, GRANT to service_role only.
--   Same access model as recalculate_trust_score and ingest_event.

-- ── reconcile_source_counts ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reconcile_source_counts()
RETURNS TABLE (event_id UUID, old_count INTEGER, new_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH correct AS (
    SELECT
      e.id                       AS eid,
      e.source_count             AS old_count,
      COUNT(eu.id)::INTEGER      AS new_count
    FROM public.events e
    LEFT JOIN public.event_updates eu ON eu.event_id = e.id
    GROUP BY e.id, e.source_count
  )
  UPDATE public.events e
  SET source_count = c.new_count
  FROM correct c
  WHERE e.id = c.eid
    AND e.source_count <> c.new_count
  RETURNING e.id, c.old_count, c.new_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_source_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_source_counts() TO service_role;

-- ── reconcile_trust_scores ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reconcile_trust_scores()
RETURNS TABLE (event_id UUID, old_score INTEGER, new_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH signal_counts AS (
    SELECT
      event_id,
      COUNT(*) FILTER (WHERE type = 'confirm')::INTEGER AS confirms,
      COUNT(*) FILTER (WHERE type = 'dispute')::INTEGER AS disputes
    FROM public.signals
    GROUP BY event_id
  ),
  correct AS (
    SELECT
      e.id                  AS eid,
      e.trust_score         AS old_score,
      CASE
        WHEN COALESCE(sc.confirms, 0) + COALESCE(sc.disputes, 0) = 0
          THEN 50  -- no signals: neutral default (matches recalculate_trust_score logic)
        ELSE GREATEST(0, LEAST(100,
               ROUND(
                 COALESCE(sc.confirms, 0)::NUMERIC /
                 (COALESCE(sc.confirms, 0) + COALESCE(sc.disputes, 0)) * 100
               )::INTEGER
             ))
      END AS new_score
    FROM public.events e
    LEFT JOIN signal_counts sc ON sc.event_id = e.id
  )
  UPDATE public.events e
  SET trust_score = c.new_score
  FROM correct c
  WHERE e.id = c.eid
    AND e.trust_score <> c.new_score
  RETURNING e.id, c.old_score, c.new_score;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_trust_scores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_trust_scores() TO service_role;
