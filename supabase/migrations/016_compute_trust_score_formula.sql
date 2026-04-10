-- 016_compute_trust_score_formula.sql
--
-- Unifies the trust score formula into a single authoritative function.
--
-- PROBLEM:
--   The scoring formula appears in two independent PL/pgSQL functions:
--
--   recalculate_trust_score() (migration 013, hot path — fires on every signal write):
--     v_score := ROUND((v_confirms::NUMERIC / v_total) * 100);
--     v_score := GREATEST(0, LEAST(100, v_score));
--     (zero-signal case handled separately: SET trust_score = 50)
--
--   reconcile_trust_scores() (migration 015, admin repair path):
--     CASE WHEN total = 0 THEN 50
--     ELSE GREATEST(0, LEAST(100, ROUND(confirms::NUMERIC / total * 100)::INTEGER))
--     END
--
--   Both say they agree but the database cannot enforce this. Any future
--   migration that adjusts the formula (e.g. different neutral default,
--   alternative rounding, weighted scoring) must update both. One will be
--   missed. The live trigger and the reconciliation tool will produce
--   different trust scores for the same signal state — silently, because
--   neither function returns an error and the reconciliation tool would
--   "repair" the live trigger's values to different numbers.
--
-- FIX:
--   Create compute_trust_score(confirms, disputes) as the single
--   authoritative formula. Both callers delegate to it. The formula now
--   lives in exactly one place.
--
-- FUNCTION DESIGN:
--   LANGUAGE sql IMMUTABLE — pure function, deterministic, no table access.
--   The planner can inline it into SQL expressions (used by reconcile_trust_scores).
--   STRICT not used: the function handles NULL inputs via COALESCE internally
--   and always returns a valid INTEGER (NULL score would be worse than 50).
--   SECURITY DEFINER + SET search_path — consistent with all other functions
--   in this codebase.
--   REVOKE from PUBLIC — internal implementation detail, not an API endpoint.

-- ── Part 1: Authoritative formula function ───────────────────────────────

CREATE OR REPLACE FUNCTION public.compute_trust_score(
  p_confirms INTEGER,
  p_disputes INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_confirms, 0) + COALESCE(p_disputes, 0) = 0
      -- No signals: neutral default.
      -- Matches the table DEFAULT (50) and represents "unassessed / no crowd data".
      -- Handles NULL inputs (from LEFT JOINs in reconcile_trust_scores).
      THEN 50
    ELSE GREATEST(0, LEAST(100,
           ROUND(
             COALESCE(p_confirms, 0)::NUMERIC
             / (COALESCE(p_confirms, 0) + COALESCE(p_disputes, 0))
             * 100
           )::INTEGER
         ))
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_trust_score(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_trust_score(INTEGER, INTEGER) TO service_role;

-- ── Part 2: Simplify recalculate_trust_score to use compute_trust_score ──

CREATE OR REPLACE FUNCTION public.recalculate_trust_score(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirms INTEGER;
  v_disputes INTEGER;
BEGIN
  -- Acquire a row lock on the event BEFORE counting signals.
  -- Serializes concurrent trust_score recomputations (see migration 009).
  -- Safe if the event is being concurrently deleted: FOR UPDATE finds no row,
  -- subsequent UPDATE matches 0 rows, function returns normally.
  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;

  SELECT
    COUNT(*) FILTER (WHERE type = 'confirm'),
    COUNT(*) FILTER (WHERE type = 'dispute')
  INTO v_confirms, v_disputes
  FROM public.signals
  WHERE event_id = p_event_id;

  -- All scoring logic (zero-signal reset, rounding, clamping) is in
  -- compute_trust_score. This function owns the event lock and the
  -- DB write; compute_trust_score owns the formula.
  UPDATE public.events
  SET trust_score = public.compute_trust_score(v_confirms, v_disputes)
  WHERE id = p_event_id;
END;
$$;

-- Permissions unchanged.
REVOKE EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) TO service_role;

-- ── Part 3: Simplify reconcile_trust_scores to use compute_trust_score ───

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
      s.event_id,
      COUNT(*) FILTER (WHERE s.type = 'confirm')::INTEGER AS confirms,
      COUNT(*) FILTER (WHERE s.type = 'dispute')::INTEGER AS disputes
    FROM public.signals s
    GROUP BY s.event_id
  ),
  correct AS (
    SELECT
      e.id           AS eid,
      e.trust_score  AS old_score,
      -- compute_trust_score handles NULL from the LEFT JOIN (no signals for event)
      -- and returns 50 in that case — same as the zero-signal path in
      -- recalculate_trust_score. Formula is authoritative in compute_trust_score.
      public.compute_trust_score(sc.confirms, sc.disputes) AS new_score
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

-- Permissions unchanged.
REVOKE EXECUTE ON FUNCTION public.reconcile_trust_scores() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_trust_scores() TO service_role;
