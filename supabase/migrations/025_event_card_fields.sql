-- 025_event_card_fields.sql
--
-- Adds image, summary, and latest_update_at to events for card-ready feed payloads.
--
-- CONTEXT:
--   IRIS event cards are image-first. The approved feed design shows:
--     [hero image]
--     Bold title
--     Trust N • Status • Xm ago
--     Short summary (1-2 sentences)
--
--   Currently none of image_url, summary, or a reliable latest_update_at
--   exist on the events row. This migration adds all three and keeps them
--   current automatically.
--
-- CHANGES:
--
-- 1. events.image_url TEXT (nullable)
--    URL of the event's hero image.
--    Populated by the ingestion pipeline; NULL until set.
--    Frontend rule: if NULL, show a deterministic fallback (topic-based
--    placeholder or blur-hash). Backend makes no assumptions about content.
--
-- 2. events.summary TEXT (nullable)
--    Short contextual summary (1-3 sentences).
--    Shown on both the feed card and the event detail page header.
--    Populated by ingestion; NULL until set.
--    Frontend may render a truncated excerpt from the first update when NULL.
--
-- 3. events.latest_update_at TIMESTAMPTZ (nullable)
--    Denormalized timestamp of the most recent event_update for this event.
--    Used for:
--      a) "Xm ago" recency label on feed cards and detail header
--      b) Chronological ordering in New and Verified feed modes
--    NULL when no updates exist yet (feed queries fall back to created_at).
--    Back-filled below for all existing events.
--
-- 4. sync_latest_update_at() trigger function (AFTER INSERT/DELETE on event_updates)
--    INSERT: if new update.created_at > current latest_update_at (or NULL), set it.
--    DELETE: recompute MAX(created_at) from remaining updates (or NULL if none left).
--    UPDATE not triggered: update content does not change the event's recency.
--    SECURITY DEFINER: runs as owner (postgres) to bypass RLS on event writes.
--
-- 5. Data back-fill
--    Populates events.latest_update_at for all existing events from
--    MAX(event_updates.created_at). Events with no updates remain NULL.
--
-- NOTE:
--    ingest_event() gains p_image_url and p_summary parameters in migration 027,
--    after migration 026 completes the event_updates schema changes.
--    Keeping schema additions and ingest_event changes in separate migrations
--    makes each migration independently reviewable.


-- ── 1. Add columns to events ─────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN image_url        TEXT,
  ADD COLUMN summary          TEXT,
  ADD COLUMN latest_update_at TIMESTAMPTZ;


-- ── 2. Back-fill latest_update_at for existing events ────────────────────────

UPDATE public.events e
  SET latest_update_at = (
    SELECT MAX(eu.created_at)
    FROM public.event_updates eu
    WHERE eu.event_id = e.id
  );


-- ── 3. sync_latest_update_at trigger function ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_latest_update_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only advance the timestamp; never move it backward.
    -- Handles out-of-order ingestion gracefully: if an older update arrives
    -- after a newer one, latest_update_at is unchanged.
    UPDATE public.events
    SET latest_update_at = NEW.created_at
    WHERE id = NEW.event_id
      AND (latest_update_at IS NULL OR NEW.created_at > latest_update_at);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- Recompute from all remaining updates for this event.
    -- If the deleted row was not the latest, the result is unchanged.
    -- If it was the latest, latest_update_at moves back to the new maximum.
    -- If no updates remain, latest_update_at becomes NULL.
    UPDATE public.events
    SET latest_update_at = (
      SELECT MAX(eu.created_at)
      FROM public.event_updates eu
      WHERE eu.event_id = OLD.event_id
    )
    WHERE id = OLD.event_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_latest_update_at ON public.event_updates;

CREATE TRIGGER sync_latest_update_at
  AFTER INSERT OR DELETE ON public.event_updates
  FOR EACH ROW EXECUTE FUNCTION public.sync_latest_update_at();


-- ── 4. Index for latest_update_at feed ordering ───────────────────────────────
--
-- get_feed_events (migration 027) orders by COALESCE(latest_update_at, created_at).
-- A partial index on non-NULL rows covers the common case efficiently.
-- Compound with created_at for the COALESCE fallback ordering.

CREATE INDEX idx_events_latest_update_at
  ON public.events (latest_update_at DESC NULLS LAST, created_at DESC);
