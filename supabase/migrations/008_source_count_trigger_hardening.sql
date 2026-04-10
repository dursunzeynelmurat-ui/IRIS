-- 008_source_count_trigger_hardening.sql
--
-- Two cleanup/hardening items for the source_count trigger:
--
-- ── Item 1: Drop dead function increment_source_count() ──────────────────
--
-- Migration 001 created increment_source_count() and attached it to trigger
-- trg_increment_source_count on event_updates (INSERT only).
-- Migration 003 dropped that trigger and replaced it with trg_sync_source_count
-- → sync_source_count(). The old function was never dropped, leaving dead code
-- in the DB function namespace. No trigger calls it; it is unreachable.
--
-- ── Item 2: Recreate sync_source_count() as SECURITY DEFINER ─────────────
--
-- Migration 003 defined sync_source_count() without SECURITY DEFINER.
-- It is currently safe: migration 005 blocks event_updates INSERT for
-- `authenticated`, and migration 004 blocks DELETE, so the trigger only fires
-- from the service-role ingestion script (which bypasses RLS). The UPDATE on
-- events therefore always runs with service-role privileges.
--
-- However, this is a latent risk: if the event_updates write restrictions were
-- ever relaxed, the trigger's UPDATE on events.source_count would be denied by
-- the RESTRICTIVE deny_events_update policy (migration 004), causing the INSERT
-- to fail for authenticated users.
--
-- SECURITY NOTE: SET search_path = public is set to prevent search-path
--   injection attacks on SECURITY DEFINER functions (Supabase best practice,
--   consistent with migration 006).

-- ── Item 1 ────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.increment_source_count();

-- ── Item 2 ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_source_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events
    SET source_count = source_count + 1
    WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events
    SET source_count = GREATEST(source_count - 1, 0)
    WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$;
