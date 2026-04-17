-- 018_latest_update_at.sql
--
-- Adds events.latest_update_at — a denormalized timestamp tracking the most
-- recent event_updates row for each event.
--
-- WHY:
--   The feed's "New" tab is currently ordered by events.created_at, which
--   reflects when an event was first ingested. Events that are still actively
--   receiving new source updates should appear near the top regardless of when
--   they were first ingested. latest_update_at enables ordering by recent
--   activity rather than original creation time.
--
-- MAINTENANCE:
--   A AFTER INSERT trigger on event_updates keeps the column in sync.
--   On INSERT, the trigger sets latest_update_at = NEW.created_at on the
--   parent event, unconditionally (every new update is more recent than any
--   previous one, because event_updates.created_at defaults to NOW()).
--
-- BACKFILL:
--   After adding the column, we set it to MAX(event_updates.created_at) for
--   all existing events that have at least one update. Events with no updates
--   (orphans, unlikely given migration 012 validation) are left NULL.
--
-- INDEX:
--   Added DESC NULLS LAST to match the feed query pattern:
--     ORDER BY latest_update_at DESC NULLS LAST, created_at DESC

-- ── Column ────────────────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS latest_update_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_events_latest_update_at
  ON public.events (latest_update_at DESC NULLS LAST);

-- ── Backfill ──────────────────────────────────────────────────────────────

UPDATE public.events e
SET latest_update_at = (
  SELECT MAX(eu.created_at)
  FROM public.event_updates eu
  WHERE eu.event_id = e.id
)
WHERE EXISTS (
  SELECT 1 FROM public.event_updates eu WHERE eu.event_id = e.id
);

-- ── Trigger function ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_event_latest_update_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.events
  SET latest_update_at = NEW.created_at
  WHERE id = NEW.event_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_event_latest_update_at ON public.event_updates;

CREATE TRIGGER trg_update_event_latest_update_at
  AFTER INSERT ON public.event_updates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_event_latest_update_at();
