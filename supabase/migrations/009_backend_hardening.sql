-- 009_backend_hardening.sql
--
-- Four hardening items addressing correctness, integrity, and security gaps
-- found in audit of migrations 001–008.
--
-- ── Item 1: Trust score concurrency race ─────────────────────────────────
--
-- PROBLEM:
--   recalculate_trust_score() runs a SELECT COUNT(*) then an UPDATE.
--   Under READ COMMITTED (Postgres default), two concurrent signal inserts
--   for the same event can each count signals before the other commits.
--   Both transactions then serialize at the UPDATE row lock, but the
--   second writer uses a stale count — it did not see the first transaction's
--   signal during its SELECT. The resulting trust_score is wrong until the
--   next signal write triggers another recount.
--
-- FIX:
--   Add SELECT ... FOR UPDATE on the events row BEFORE counting signals.
--   This acquires the row lock early, forcing concurrent recomputations to
--   serialize at the lock. The second transaction waits until the first
--   commits (releasing the lock), then recounts with the correct committed
--   state. The lock is held only until the end of the transaction, which
--   is already the case for the subsequent UPDATE.
--
-- IMPACT: Slightly higher lock contention under concurrent signaling.
--   Acceptable for MVP; eliminates permanently-wrong scores.
--
-- ── Item 2: Block direct RPC calls to recalculate_trust_score ────────────
--
-- PROBLEM:
--   By default, Postgres grants EXECUTE on all functions to PUBLIC.
--   PostgREST exposes VOID-returning functions as callable RPCs.
--   Any authenticated or anonymous client can invoke
--   recalculate_trust_score() directly via the REST API with just
--   the anon key. The client no longer calls this (signalService.ts
--   was updated in migration 006 work), making it dead API surface.
--   While the call produces a correct result, it is an unnecessary
--   exposure of an internal server-side function.
--
-- FIX:
--   REVOKE EXECUTE from PUBLIC. GRANT to service_role for admin use.
--   Trigger-based calls from trigger_sync_trust_score() are unaffected:
--   SECURITY DEFINER functions run as their owner (postgres/superuser)
--   which is not subject to EXECUTE grants.
--
-- ── Item 3: Signals — enforce field immutability after creation ───────────
--
-- PROBLEM:
--   Migration 007 added WITH CHECK (auth.uid() = user_id) to
--   signals_update_own. This prevents reassigning a signal to another user
--   (user_id change blocked). However, event_id is unchecked.
--
--   An authenticated user can UPDATE event_id on their signal to a different
--   event. Both USING and WITH CHECK pass (user_id is unchanged). The trust
--   score trigger fires for NEW.event_id (the target event gains a signal)
--   but OLD.event_id never gets recounted (the source event now has one
--   fewer signal but trust_score is not updated). Both scores become stale.
--
--   created_at is also unchecked; allowing it to be changed would corrupt
--   the timeline ordering of user activity.
--
-- FIX:
--   Add a BEFORE UPDATE trigger on signals that raises an exception if
--   event_id, user_id, or created_at differ from their original values.
--   Only `type` is a valid update target (changing your vote via upsert).
--   This is enforced at the DB level regardless of RLS or client behavior.
--
--   The trigger uses IS DISTINCT FROM (NULL-safe) so it correctly handles
--   NULL comparisons. Normal upsert (ON CONFLICT DO UPDATE SET type = ...)
--   leaves user_id/event_id/created_at unchanged → passes cleanly.
--
-- ── Item 4: handle_new_user — add SET search_path ────────────────────────
--
-- PROBLEM:
--   handle_new_user() is SECURITY DEFINER but lacks SET search_path = public.
--   A search_path injection attack could cause table/function resolution to
--   use a malicious schema. Inconsistent with the SECURITY DEFINER pattern
--   established for all other trigger functions in migrations 006 and 008.
--
-- FIX:
--   Recreate with SET search_path = public. Behavior is identical.

-- ── Item 1 + 2: Recreate recalculate_trust_score with FOR UPDATE + revoke ─

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
  -- This serializes concurrent trust_score recalculations: if two signal
  -- writes happen simultaneously, the second trigger waits here until the
  -- first transaction commits, then recounts with the fully committed state.
  -- Without this lock, both triggers could COUNT before either commits,
  -- producing a stale score that persists until the next signal write.
  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;

  SELECT
    COUNT(*) FILTER (WHERE type = 'confirm'),
    COUNT(*) FILTER (WHERE type = 'dispute')
  INTO v_confirms, v_disputes
  FROM public.signals
  WHERE event_id = p_event_id;

  v_total := v_confirms + v_disputes;

  -- No signals yet: leave score unchanged (divide-by-zero guard).
  -- Can happen if the triggering signal was deleted before we ran,
  -- or if this is called administratively on an event with no signals.
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

-- Remove from public access: this is an internal function now driven
-- entirely by the signals trigger. Direct RPC calls serve no product purpose.
REVOKE EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) FROM PUBLIC;
-- Keep accessible for service_role admin/tooling use (bypasses RLS anyway,
-- but the explicit grant makes intent clear).
GRANT EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) TO service_role;

-- ── Item 3: Signals field immutability trigger ────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_signal_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.user_id    IS DISTINCT FROM OLD.user_id)    OR
     (NEW.event_id   IS DISTINCT FROM OLD.event_id)   OR
     (NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION
      'signals: user_id, event_id, and created_at are immutable after creation. Only type may be changed.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS signals_enforce_immutable_fields ON public.signals;

CREATE TRIGGER signals_enforce_immutable_fields
  BEFORE UPDATE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_signal_immutable_fields();

-- ── Item 4: handle_new_user — add SET search_path ────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;
