-- 004_explicit_deny_policies.sql
-- Adds explicit RESTRICTIVE policies to lock down write access on tables that
-- should be read-only or have tightly scoped writes.
-- "RESTRICTIVE" policies are ANDed with all PERMISSIVE policies — a row must
-- pass both to be returned/modified. This prevents privilege escalation even
-- if a future permissive policy is added accidentally.

-- ── events ────────────────────────────────────────────────────────────────
-- Events are inserted and updated by the ingestion script (service-role key,
-- which bypasses RLS entirely). No authenticated end-user should be able to
-- INSERT, UPDATE, or DELETE event rows.

CREATE POLICY "deny_events_insert" ON events
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "deny_events_update" ON events
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY "deny_events_delete" ON events
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);

-- ── event_updates ─────────────────────────────────────────────────────────
-- event_updates are managed by the ingestion script (service-role key, bypasses RLS).
-- No authenticated end-user should UPDATE or DELETE updates.
-- INSERT for authenticated users is blocked separately by migration 005.

CREATE POLICY "deny_event_updates_update" ON event_updates
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY "deny_event_updates_delete" ON event_updates
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);

-- ── users ─────────────────────────────────────────────────────────────────
-- The `users` table mirrors auth.users for app-level profile data.
-- Rows are created by a trigger (or service role), not directly by clients.

CREATE POLICY "deny_users_insert" ON users
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "deny_users_update" ON users
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY "deny_users_delete" ON users
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);
