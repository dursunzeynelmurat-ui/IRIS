-- 005_deny_event_updates_insert.sql
--
-- PROBLEM: migration 001 created "event_updates_insert_auth" which allows any
-- authenticated user (auth.uid() IS NOT NULL) to INSERT event_updates directly
-- from the client app using only the anon key.
--
-- The ingestion script uses the service-role key which bypasses RLS entirely —
-- it never relied on this permissive policy.
--
-- PRODUCT RULE VIOLATED: event_updates are managed by trusted server-side
-- workflows only. Authentication enables signaling, not content creation.
--
-- FIX:
--   1. Drop the incorrect permissive INSERT policy from migration 001.
--   2. Add a RESTRICTIVE deny for INSERT (belt-and-suspenders: blocks even if a
--      future accidental permissive INSERT policy is added).
--
-- IMPACT: zero — the ingestion script (service role) bypasses RLS.

DROP POLICY IF EXISTS "event_updates_insert_auth" ON public.event_updates;

CREATE POLICY "deny_event_updates_insert" ON public.event_updates
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);
