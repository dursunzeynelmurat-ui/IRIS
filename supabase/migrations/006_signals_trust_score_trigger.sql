-- 006_signals_trust_score_trigger.sql
--
-- PROBLEM (audit finding):
--   recalculate_trust_score() uses SECURITY INVOKER (the default), so it
--   runs as the role that called it. Migration 004 added a RESTRICTIVE deny
--   on events UPDATE for the `authenticated` role. Result: every client RPC
--   call to recalculate_trust_score() has been failing with an RLS error
--   since migration 004 was applied. signalService.ts treated this as
--   "non-fatal", swallowed the error, and returned normally — trust_score
--   has never been updated from client-side signal submissions since then.
--
-- FIX — two parts:
--
--   Part 1: Recreate recalculate_trust_score() as SECURITY DEFINER.
--     It now runs as its owner (the postgres/superuser role), which has
--     BYPASSRLS. It can read all signals and UPDATE events.trust_score
--     regardless of who called it.
--
--   Part 2: Add an AFTER INSERT OR UPDATE trigger on signals.
--     recalculate_trust_score is now called automatically within the same
--     transaction that writes the signal row. trust_score is always
--     recalculated atomically — no client RPC call needed, no silent failure
--     possible.
--
-- CLIENT CHANGE: signalService.castSignal() drops the explicit rpc() call.
--   The trigger fires on every signal upsert, so Realtime still emits the
--   events UPDATE that all subscribed clients receive.
--
-- CONCURRENCY NOTE: The trigger fires inside the writing transaction.
--   trust_score is recalculated from the committed state visible at that
--   point. The row lock on events serializes concurrent writes, so the
--   final committed value is the result of the last transaction to commit.
--
-- SECURITY NOTE: SET search_path = public prevents search-path injection
--   attacks on SECURITY DEFINER functions (Supabase best practice).

-- ── Part 1: Recreate with SECURITY DEFINER ───────────────────────────────

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
  SELECT
    COUNT(*) FILTER (WHERE type = 'confirm'),
    COUNT(*) FILTER (WHERE type = 'dispute')
  INTO v_confirms, v_disputes
  FROM public.signals
  WHERE event_id = p_event_id;

  v_total := v_confirms + v_disputes;

  -- No signals yet: leave score unchanged (divide-by-zero guard)
  IF v_total = 0 THEN
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

-- ── Part 2: Trigger function + trigger ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.trigger_sync_trust_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_trust_score(NEW.event_id);
  RETURN NEW;
END;
$$;

-- Drop first so re-running this migration is safe
DROP TRIGGER IF EXISTS signals_sync_trust_score ON public.signals;

CREATE TRIGGER signals_sync_trust_score
  AFTER INSERT OR UPDATE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_trust_score();
