-- 032_extend_event_updates.sql
--
-- Extends event_updates to support the Phase 2 pipeline:
--
-- NEW COLUMNS:
--   published_at              — When the source published this information.
--                               Distinct from created_at (pipeline ingestion time).
--                               Used for timeline ordering in the detail page.
--
--   display_order_time        — Explicit ordering timestamp. Defaults to
--                               COALESCE(published_at, created_at).
--                               Allows editorial reordering without changing
--                               immutable timestamps.
--
--   normalized_source_item_id — FK to normalized_source_items; connects the
--                               visible update back to the full normalized record.
--
--   confidence                — 0–100 confidence in this update's accuracy.
--                               100 = officially confirmed, 50 = single unverified
--                               report, etc. Drives how the update is rendered.
--
--   impact_delta_trust        — Net change in trust_score when this update
--                               was processed. Stored for audit/debugging.
--
--   impact_delta_importance   — Net change in importance_score.
--
--   is_visible                — Whether this update appears in the timeline.
--                               Repetitive or low-value updates are set to false
--                               by the pipeline; they are stored but not shown.
--
-- UPDATE_TYPE EXPANSION:
--   Current values (migration 026): report | witness | official | confirmed |
--                                   under_verification | analysis | correction
--
--   Added Phase 2 values: first_report | official_confirmation | casualty_update |
--                         location_refinement | escalation | deescalation |
--                         denial | contradiction | closure | generic_update
--
--   Both sets coexist. The Phase 2 pipeline uses Phase 2 values; existing data
--   retains Phase 1 values. Frontend icon/color mapping should handle all.
--
-- TRIGGER UPDATES:
--   The sync_source_count trigger continues to count ALL event_updates rows
--   (source_count = total coverage count).
--   A new trigger sync_update_count() maintains events.update_count as the
--   count of VISIBLE updates (is_visible = true), which feeds the "N updates"
--   display on event cards.


-- ── 1. Add columns ─────────────────────────────────────────────────────────

ALTER TABLE public.event_updates
  ADD COLUMN published_at              TIMESTAMPTZ,
  ADD COLUMN display_order_time        TIMESTAMPTZ,
  ADD COLUMN normalized_source_item_id UUID        REFERENCES public.normalized_source_items(id) ON DELETE SET NULL,
  ADD COLUMN confidence                INTEGER     NOT NULL DEFAULT 70
                                                   CHECK (confidence >= 0 AND confidence <= 100),
  ADD COLUMN impact_delta_trust        INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN impact_delta_importance   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN is_visible                BOOLEAN     NOT NULL DEFAULT true;


-- ── 2. Back-fill display_order_time ────────────────────────────────────────
--
-- For existing rows: display_order_time = created_at (no published_at known)

UPDATE public.event_updates
  SET display_order_time = created_at;


-- ── 3. Expand update_type CHECK ────────────────────────────────────────────
--
-- Drop the existing CHECK from migration 026, replace with expanded set.

ALTER TABLE public.event_updates
  DROP CONSTRAINT chk_event_updates_update_type;

ALTER TABLE public.event_updates
  ADD CONSTRAINT chk_event_updates_update_type
  CHECK (update_type IN (
    -- Phase 1 values (migration 026): display-oriented
    'report', 'witness', 'official', 'confirmed', 'under_verification',
    'analysis', 'correction',
    -- Phase 2 values: lifecycle-oriented
    'first_report', 'official_confirmation', 'casualty_update',
    'location_refinement', 'escalation', 'deescalation',
    'denial', 'contradiction', 'closure', 'generic_update'
  ));


-- ── 4. Indexes ─────────────────────────────────────────────────────────────

-- Timeline query: visible updates for an event, ordered for display
CREATE INDEX idx_event_updates_visible_display
  ON public.event_updates (event_id, display_order_time DESC)
  WHERE is_visible = true;

-- Normalized item link for backward-tracing
CREATE INDEX idx_event_updates_norm_item
  ON public.event_updates (normalized_source_item_id)
  WHERE normalized_source_item_id IS NOT NULL;


-- ── 5. sync_update_count trigger ───────────────────────────────────────────
--
-- Maintains events.update_count = COUNT(event_updates WHERE is_visible = true).
-- Fires AFTER INSERT, UPDATE, DELETE on event_updates.
-- UPDATE is needed because is_visible may be toggled without inserting/deleting.
--
-- NOTE: source_count is maintained by the existing sync_source_count trigger
-- (migration 003/008) and counts ALL event_update rows (visible + hidden).
-- update_count is a separate, smaller count for display purposes.

CREATE OR REPLACE FUNCTION public.sync_update_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Determine the affected event_id
  IF TG_OP = 'DELETE' THEN
    v_event_id := OLD.event_id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  -- Recount visible updates for this event
  UPDATE public.events
  SET update_count = (
    SELECT COUNT(*)
    FROM public.event_updates
    WHERE event_id = v_event_id AND is_visible = true
  )
  WHERE id = v_event_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_update_count ON public.event_updates;

CREATE TRIGGER trg_sync_update_count
  AFTER INSERT OR UPDATE OR DELETE ON public.event_updates
  FOR EACH ROW EXECUTE FUNCTION public.sync_update_count();


-- ── 6. Back-fill update_count ──────────────────────────────────────────────
--
-- All existing updates have is_visible=true (default), so update_count = source_count
-- for all existing events. The trigger handles future changes.

UPDATE public.events e
  SET update_count = (
    SELECT COUNT(*) FROM public.event_updates eu
    WHERE eu.event_id = e.id AND eu.is_visible = true
  );
