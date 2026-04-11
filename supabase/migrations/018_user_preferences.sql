-- 018_user_preferences.sql
--
-- Adds the user_preferences table for per-user app preferences.
-- Initial preference: theme (system | light | dark).
--
-- DESIGN DECISIONS:
--
-- 1. Separate table, not a column on public.users.
--    public.users is locked by RESTRICTIVE deny_users_update (migration 004):
--    all authenticated UPDATE attempts on that table are blocked. Adding a
--    theme column there would make user-initiated preference writes impossible
--    without weakening that existing security boundary. A separate table avoids
--    touching the hardened users table entirely.
--
-- 2. Auto-created on signup via handle_new_user() trigger.
--    Every authenticated user always has exactly one preferences row. No
--    client-side "create if missing" logic needed on first access.
--
-- 3. No DELETE policy for authenticated.
--    Users update their preferences (back to defaults if needed); they do not
--    delete the row. Absence of any permissive DELETE policy for authenticated
--    means PostgreSQL denies it by default under RLS. The RESTRICTIVE
--    deny_prefs_delete policy below makes this intent machine-verifiable via
--    pg_policies, consistent with the deny patterns on all other tables.
--
-- 4. Anon is denied ALL access via RESTRICTIVE policy, consistent with
--    deny_signals_anon and deny_users_anon (migration 010).
--
-- SCOPE NOTE (feed / personalization):
--    This table stores UI preferences only. "For You" feed, recommendation
--    algorithms, and any form of content personalization are explicitly out of
--    scope and are NOT implemented here. This table is intentionally named
--    user_preferences (not user_profile or user_feed_settings) to keep the
--    boundary clear.


-- ── Table ─────────────────────────────────────────────────────────────────

CREATE TABLE public.user_preferences (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme      TEXT        NOT NULL DEFAULT 'system'
                         CHECK (theme IN ('system', 'light', 'dark')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Authenticated: read own row
CREATE POLICY "prefs_read_own" ON public.user_preferences
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Authenticated: insert own row
-- Normally the handle_new_user trigger creates this row. This INSERT policy
-- allows a bootstrap upsert if the trigger did not fire (e.g. existing users
-- before this migration was applied, or manual account creation via API).
CREATE POLICY "prefs_insert_own" ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Authenticated: update own row
CREATE POLICY "prefs_update_own" ON public.user_preferences
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RESTRICTIVE: anon cannot access this table at all.
-- Consistent with deny_signals_anon and deny_users_anon (migration 010).
CREATE POLICY "deny_prefs_anon" ON public.user_preferences
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- RESTRICTIVE: authenticated cannot delete their preferences row.
-- Makes the intent machine-verifiable (consistent with deny patterns on all
-- other tables). Rows are removed only via CASCADE on auth.users deletion.
CREATE POLICY "deny_prefs_delete" ON public.user_preferences
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);


-- ── Extend handle_new_user to bootstrap preferences on signup ─────────────
--
-- CREATE OR REPLACE preserves the trigger binding — no need to drop and
-- recreate the trigger on auth.users. SECURITY DEFINER + SET search_path
-- maintained from migration 009.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;
