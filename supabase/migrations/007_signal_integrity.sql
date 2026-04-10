-- 007_signal_integrity.sql
--
-- Fixes two permission gaps in the signals table left by migration 001.
--
-- ── Gap 1: DELETE was allowed for authenticated users ─────────────────────
--
-- Migration 001 created `signals_delete_own`, allowing authenticated users to
-- DELETE their own signal rows.
--
-- PRODUCT RULE VIOLATED:
--   The product allows changing a vote (upsert: ON CONFLICT DO UPDATE). It does
--   not expose a "remove vote" action. Authentication enables signaling, not
--   signal deletion.
--
-- INTEGRITY RISK:
--   The trust_score trigger (migration 006) fires on INSERT and UPDATE only.
--   Deleting a signal bypasses the trigger entirely, leaving trust_score
--   permanently stale. The UI has no delete button, but the anon-key REST API
--   accepts DELETE requests from any authenticated session.
--
-- FIX:
--   Add a RESTRICTIVE deny on DELETE for `authenticated`. Service role (used by
--   admin tooling and data cleanup) bypasses RLS and is unaffected.
--
-- ── Gap 2: signals_update_own lacked WITH CHECK ───────────────────────────
--
-- Migration 001 created `signals_update_own` with USING (auth.uid() = user_id)
-- but no WITH CHECK clause.
--
-- RLS semantics:
--   USING validates the row BEFORE the update (the row must belong to the caller).
--   WITH CHECK validates the row AFTER the update (the result must also be valid).
--   Without WITH CHECK, the post-update row is unrestricted — an authenticated
--   user can UPDATE user_id or event_id to arbitrary values, reassigning the
--   signal to another user or event while bypassing ownership rules.
--
-- FIX:
--   Recreate the policy with WITH CHECK (auth.uid() = user_id), ensuring the
--   updated row still belongs to the authenticated user.

-- ── Part 1: Block signal deletion for authenticated users ─────────────────

CREATE POLICY "deny_signals_delete" ON public.signals
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);

-- ── Part 2: Recreate UPDATE policy with WITH CHECK ────────────────────────

DROP POLICY IF EXISTS "signals_update_own" ON public.signals;

CREATE POLICY "signals_update_own" ON public.signals
  FOR UPDATE TO authenticated
  USING    (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
