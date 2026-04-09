-- ============================================================
-- IRIS — Migration 003: fix source_count trigger
-- ============================================================
-- 001_initial_schema.sql only incremented source_count on INSERT.
-- This migration replaces that function and trigger to also
-- decrement on DELETE, keeping the count accurate if updates
-- are ever removed.
-- ============================================================

-- Replace the trigger function to handle both INSERT and DELETE
CREATE OR REPLACE FUNCTION sync_source_count()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- Drop the old INSERT-only trigger
DROP TRIGGER IF EXISTS trg_increment_source_count ON public.event_updates;

-- New trigger covers INSERT and DELETE
CREATE TRIGGER trg_sync_source_count
AFTER INSERT OR DELETE ON public.event_updates
FOR EACH ROW EXECUTE FUNCTION sync_source_count();
