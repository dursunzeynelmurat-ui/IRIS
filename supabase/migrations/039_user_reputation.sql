-- 039_user_reputation.sql
--
-- Adds per-user reputation tracking for the signal lead system (migration 040).
--
-- REPUTATION MODEL:
--   reputation_score  0–200, default 100 (neutral starting point).
--   Adjustments are made by the lead-processing pipeline (service_role only):
--     +5  accepted lead (useful, correctly matched, not duplicate)
--     -5  rejected lead (low quality, irrelevant, or redundant)
--    -15  misleading strike (false or manipulative content)
--    Cap: score never drops below 0 or rises above 200.
--
-- DAILY LEAD CAP (enforced in submit_signal_lead, migration 040):
--   score <  30  → 2 leads / 24 h
--   score <  60  → 5 leads / 24 h
--   score < 100  → 10 leads / 24 h
--   score ≥ 100  → 20 leads / 24 h
--
-- BLOCKING:
--   blocked_until is set by the processing pipeline when misleading_strikes ≥ 3
--   within a 30-day window (24-hour block by default).
--   Non-null blocked_until > NOW() prevents all lead submissions.
--
-- BOOTSTRAP:
--   handle_new_user() creates the reputation row alongside the preferences row.
--   Failure is non-blocking (same nested exception pattern as migration 018).
--   Safety-net: submit_signal_lead upserts the row if missing.
--
-- RPC:
--   get_my_reputation() — authenticated users can read their own row.
--   No direct write access from the app layer.


-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE public.user_reputation (
  user_id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reputation_score   INTEGER     NOT NULL DEFAULT 100
                                 CHECK (reputation_score >= 0 AND reputation_score <= 200),
  total_leads        INTEGER     NOT NULL DEFAULT 0,
  accepted_leads     INTEGER     NOT NULL DEFAULT 0,
  rejected_leads     INTEGER     NOT NULL DEFAULT 0,
  misleading_strikes INTEGER     NOT NULL DEFAULT 0,
  blocked_until      TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_reputation_blocked
  ON public.user_reputation (blocked_until)
  WHERE blocked_until IS NOT NULL;


-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_reputation ENABLE ROW LEVEL SECURITY;

-- Authenticated: read own row.
CREATE POLICY "rep_read_own" ON public.user_reputation
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- RESTRICTIVE: no direct writes — mutations go through service_role RPCs only.
CREATE POLICY "deny_rep_writes" ON public.user_reputation
  AS RESTRICTIVE FOR ALL
  USING (false) WITH CHECK (false);

-- RESTRICTIVE: anon has no access — consistent with all other user-scoped tables.
CREATE POLICY "deny_rep_anon" ON public.user_reputation
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);


-- ── RPC: get_my_reputation ────────────────────────────────────────────────────

CREATE FUNCTION public.get_my_reputation()
RETURNS TABLE (
  reputation_score   INTEGER,
  total_leads        INTEGER,
  accepted_leads     INTEGER,
  rejected_leads     INTEGER,
  misleading_strikes INTEGER,
  blocked_until      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    reputation_score,
    total_leads,
    accepted_leads,
    rejected_leads,
    misleading_strikes,
    blocked_until
  FROM public.user_reputation
  WHERE user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_reputation() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_reputation() TO authenticated;


-- ── Extend handle_new_user ────────────────────────────────────────────────────
--
-- Adds reputation row bootstrap alongside the existing preferences bootstrap.
-- Same non-blocking pattern: failure raises WARNING and does not abort signup.
-- CREATE OR REPLACE preserves the trigger binding on auth.users.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Primary: create public profile row. Failure correctly aborts signup.
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email);

  -- Secondary: preferences row (non-blocking).
  BEGIN
    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'handle_new_user: failed to create user_preferences for user_id=%, error: %',
      NEW.id, SQLERRM;
  END;

  -- Secondary: reputation row (non-blocking).
  BEGIN
    INSERT INTO public.user_reputation (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'handle_new_user: failed to create user_reputation for user_id=%, error: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
