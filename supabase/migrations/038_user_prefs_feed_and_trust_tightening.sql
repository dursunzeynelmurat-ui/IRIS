-- 038_user_prefs_feed_and_trust_tightening.sql
--
-- Two targeted changes:
--
-- 1. default_home_feed on user_preferences
--    Adds a persistent preference for which feed tab (new | verified | rising)
--    the user lands on when opening the app. Defaults to 'new'.
--    Integrates cleanly with the existing preferences model (migration 018).
--    No change to handle_new_user is required — the NOT NULL DEFAULT means
--    new rows and existing rows both carry the correct default automatically.
--
-- 2. Crowd signal trust multiplier: 0.2 → 0.15
--    Tightens the maximum crowd influence on trust_score from ±10 pts to ±7.5 pts.
--    The authoritative composite formula in migration 024 uses:
--      trust_score = clamp(source_score + (crowd_score - 50) * 0.2, 0, 100)
--    Changing the multiplier to 0.15 gives:
--      crowd_score 100 → +7.5 maximum boost  (was +10)
--      crowd_score   0 → -7.5 maximum penalty (was -10)
--    This matches the locked product rule: Confirm/Dispute is a lightweight
--    community signal capped at roughly 7–8% effective trust influence.
--    All callers (recalculate_event_scores, reconcile_event_scores) already
--    delegate to compute_trust_score — no caller changes required.
--    Existing trust scores are corrected on the next recomputation per event.


-- ── 1. default_home_feed ──────────────────────────────────────────────────────

ALTER TABLE public.user_preferences
  ADD COLUMN default_home_feed TEXT NOT NULL DEFAULT 'new'
  CHECK (default_home_feed IN ('new', 'verified', 'rising'));


-- ── 2. Crowd trust multiplier 0.2 → 0.15 ─────────────────────────────────────
--
-- Supersedes the compute_trust_score definition in migration 024.
-- Signature is unchanged: (source_score INTEGER, crowd_score INTEGER) → INTEGER.

CREATE OR REPLACE FUNCTION public.compute_trust_score(
  p_source_score INTEGER,
  p_crowd_score  INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0, LEAST(100,
    ROUND(
      COALESCE(p_source_score, 50) + (COALESCE(p_crowd_score, 50) - 50) * 0.15
    )::INTEGER
  ));
$$;

REVOKE EXECUTE ON FUNCTION public.compute_trust_score(INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_trust_score(INTEGER, INTEGER) TO service_role;
