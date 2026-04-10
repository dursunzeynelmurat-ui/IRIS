-- 013_trust_score_on_signal_delete.sql
--
-- Two related trust score correctness gaps:
--
-- ── Gap 1: Trigger does not fire on signal DELETE ─────────────────────────
--
-- PROBLEM:
--   signals_sync_trust_score fires AFTER INSERT OR UPDATE only.
--   Signal rows can be deleted via:
--     a) CASCADE from auth.users delete (user account removed → all their
--        signals cascade-delete). This is the most realistic path.
--     b) CASCADE from events delete (event removed → signals go with it;
--        benign because the event itself is gone).
--     c) Direct service-role DELETE (admin data surgery).
--
--   For case (a): when a user account is deleted their signal disappears but
--   trust_score never recomputes. Example:
--     - 1 confirm + 1 dispute → trust_score = 50
--     - confirm user's account deleted → 0 confirms + 1 dispute remain
--     - correct trust_score = 0, actual trust_score = 50 (permanently stale)
--
-- FIX:
--   Extend trigger_sync_trust_score() to handle TG_OP = 'DELETE' by calling
--   recalculate_trust_score(OLD.event_id). For case (b), the events row is
--   already deleted so the FOR UPDATE finds nothing and the UPDATE is a no-op
--   (0 rows matched); no error raised, safe to ignore.
--
--   Recreate trigger as AFTER INSERT OR UPDATE OR DELETE.
--
-- ── Gap 2: Zero-signal case leaves stale score ───────────────────────────
--
-- PROBLEM:
--   recalculate_trust_score() has:
--     IF v_total = 0 THEN
--       RETURN;  -- "leave score unchanged"
--     END IF;
--
--   When the LAST signal for an event is deleted (e.g. the only user who
--   voted has their account deleted), v_total = 0 after the delete and the
--   RETURN guard leaves trust_score at its last computed value indefinitely.
--   Example: 1 confirm → trust_score = 100. User deleted → 0 signals →
--   trust_score stays 100. The event has no supporting signals but still
--   shows maximum trust.
--
-- FIX:
--   When v_total = 0, reset trust_score to 50 (the table-level DEFAULT,
--   representing neutral/unassessed). 50 is the correct value for an event
--   with no crowd signals. The "leave unchanged" guard was a conservative
--   measure for the case of calling the function before any signals arrive,
--   but the table default is already 50 in that scenario — resetting to 50
--   is always correct.
--
-- CONCURRENCY NOTE:
--   The FOR UPDATE lock acquired at the top of recalculate_trust_score
--   serializes concurrent recomputations as before. For DELETE triggers, if
--   the event row is also being deleted in the same transaction (cascade from
--   events), the FOR UPDATE finds no row (the event is already deleted within
--   the transaction), the function computes v_total = 0, the UPDATE matches
--   0 rows, and returns normally without error. Safe.

-- ── Part 1: Recreate recalculate_trust_score with zero-signal reset ───────

CREATE OR REPLACE FUNCTION public.recalculate_trust_score(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirms INTEGER;
  v_disputes INTEGER;
  v_total    INTEGER;
  v_score    INTEGER;
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

  v_total := v_confirms + v_disputes;

  IF v_total = 0 THEN
    -- No signals: reset to the neutral default (50).
    -- This handles the case where the last signal was just deleted (e.g.
    -- CASCADE from auth.users delete). Leaving the previous score in place
    -- would cause permanently stale trust scores with no remaining signals.
    -- 50 is the table DEFAULT and represents "unassessed / no crowd data".
    UPDATE public.events
    SET trust_score = 50
    WHERE id = p_event_id;
    RETURN;
  END IF;

  v_score := ROUND((v_confirms::NUMERIC / v_total) * 100);
  -- Belt-and-suspenders clamp (CHECK constraint on events also enforces this)
  v_score := GREATEST(0, LEAST(100, v_score));

  UPDATE public.events
  SET trust_score = v_score
  WHERE id = p_event_id;
END;
$$;

-- Permissions unchanged: internal function, service_role only.
REVOKE EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) TO service_role;

-- ── Part 2: Extend trigger_sync_trust_score to handle DELETE ─────────────

CREATE OR REPLACE FUNCTION public.trigger_sync_trust_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Use OLD.event_id — NEW does not exist for DELETE
    PERFORM public.recalculate_trust_score(OLD.event_id);
    RETURN OLD;
  END IF;
  -- INSERT or UPDATE
  PERFORM public.recalculate_trust_score(NEW.event_id);
  RETURN NEW;
END;
$$;

-- Recreate trigger to cover DELETE as well
DROP TRIGGER IF EXISTS signals_sync_trust_score ON public.signals;

CREATE TRIGGER signals_sync_trust_score
  AFTER INSERT OR UPDATE OR DELETE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_trust_score();
