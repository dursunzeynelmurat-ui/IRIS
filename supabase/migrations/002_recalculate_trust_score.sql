-- ============================================================
-- IRIS — Migration 002: recalculate_trust_score RPC
-- ============================================================
-- Counts confirm/dispute signals for an event and writes the
-- result back to events.trust_score.
--
-- Atomic: SELECT + UPDATE run in one transaction; concurrent
-- calls serialize on the row lock of the events table.
--
-- Client call:
--   supabase.rpc('recalculate_trust_score', { p_event_id: '...' })
-- ============================================================

CREATE OR REPLACE FUNCTION recalculate_trust_score(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
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

  -- Edge case: no signals yet → leave score unchanged (no divide-by-zero)
  IF v_total = 0 THEN
    RETURN;
  END IF;

  v_score := ROUND((v_confirms::NUMERIC / v_total) * 100);

  UPDATE public.events
  SET trust_score = v_score
  WHERE id = p_event_id;
END;
$$;
