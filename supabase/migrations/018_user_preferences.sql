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
--    The preferences INSERT in handle_new_user() is wrapped in a nested
--    exception block so that any failure (transient error, table issue, etc.)
--    does NOT block signup. The public.users INSERT and the auth.users INSERT
--    are what constitute a successful signup; the preferences row is secondary
--    and can be bootstrapped on first use via useUserPreferences.updateTheme()
--    which upserts (prefs_insert_own policy exists for exactly this case).
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

-- Authenticated: insert own row.
-- Normally the handle_new_user trigger creates this row. This INSERT policy
-- allows a bootstrap upsert if the trigger did not fire (e.g. existing users
-- before this migration was applied, manual account creation via API, or a
-- transient failure in the trigger's preferences INSERT path).
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
-- CREATE OR REPLACE preserves the trigger binding on auth.users — no need to
-- drop and recreate the trigger. SECURITY DEFINER + SET search_path maintained
-- from migration 009.
--
-- handle_new_user() runs as its owner (postgres/superuser, BYPASSRLS) inside
-- the same transaction as the auth.users INSERT. Both the public.users row
-- and the user_preferences row are created atomically on signup.
--
-- EXCEPTION STRATEGY:
--   The public.users INSERT is the critical outcome — a failure there should
--   abort signup (an auth user with no matching public.users row is broken).
--   The user_preferences INSERT is secondary — if it fails, the user can still
--   sign in and their preferences row will be created on first write via the
--   client-side upsert in useUserPreferences.updateTheme() (prefs_insert_own
--   policy allows authenticated users to insert their own row).
--
--   Wrapping the preferences INSERT in a nested BEGIN/EXCEPTION block means:
--   - A failure in user_preferences creation logs a WARNING but does NOT
--     propagate to the outer block.
--   - The outer function returns NEW — the auth.users INSERT succeeds.
--   - The public.users INSERT in the outer block (before the nested block) is
--     NOT rolled back; it is committed with the auth.users INSERT.
--   - Only the user_preferences INSERT subtransaction is rolled back on error.
--
-- ON CONFLICT DO NOTHING:
--   Defensive guard against duplicate trigger invocations or a preferences row
--   that was manually pre-created for this user_id. Prevents a primary-key
--   violation from reaching the exception handler unnecessarily.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Primary outcome: create the public profile row.
  -- If this fails, the exception propagates — signup correctly aborts.
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);

  -- Secondary outcome: create the default preferences row.
  -- Wrapped in a nested block so that any failure here does NOT abort signup.
  -- Failure is logged as a WARNING so it is visible in DB logs without
  -- silently swallowing the error.
  BEGIN
    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'handle_new_user: failed to create user_preferences for user_id=%, error: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
