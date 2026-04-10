-- 010_explicit_anon_deny.sql
--
-- IRIS product rule: "anonymous users do not enter the app."
-- This rule is enforced at the application layer (App.tsx auth gate).
-- This migration enforces it at the database layer for the two sensitive
-- tables: signals and users.
--
-- CURRENT STATE (before this migration):
--   signals and users are protected from anon reads by the USING clause
--   `auth.uid() = user_id/id`. For the `anon` role, auth.uid() returns NULL,
--   so `NULL = user_id` evaluates to NULL (not TRUE), effectively blocking
--   all access. This is correct but relies on implicit NULL semantics:
--   it would silently break if the behavior of auth.uid() ever changed
--   for the anon role, or if a future permissive policy used a different
--   expression that happened to return TRUE for anon.
--
-- WHY ADD EXPLICIT DENY:
--   RESTRICTIVE policies are ANDed with all other policies. Even if a future
--   developer accidentally adds a permissive SELECT/INSERT/UPDATE/DELETE policy
--   that applies to `anon` on these tables, this RESTRICTIVE deny blocks it.
--   The product rule is now machine-verifiable by querying pg_policies:
--   "deny_signals_anon" and "deny_users_anon" must exist and be RESTRICTIVE.
--
-- WHY NOT deny events and event_updates:
--   Events and event_updates are public information. The product design
--   permits anonymous reads (the data is not sensitive). Authenticated-only
--   access to events would require app changes and is not current product scope.
--
-- NOTE: service_role bypasses RLS entirely and is unaffected by this migration.

-- ── signals: explicit anon deny ───────────────────────────────────────────

DROP POLICY IF EXISTS "deny_signals_anon" ON public.signals;

CREATE POLICY "deny_signals_anon" ON public.signals
  AS RESTRICTIVE FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- ── users: explicit anon deny ─────────────────────────────────────────────

DROP POLICY IF EXISTS "deny_users_anon" ON public.users;

CREATE POLICY "deny_users_anon" ON public.users
  AS RESTRICTIVE FOR ALL TO anon
  USING (false)
  WITH CHECK (false);
