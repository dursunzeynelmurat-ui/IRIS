-- 026_update_type_and_headline.sql
--
-- Adds structured classification and headline to event_updates for
-- timeline rendering on the IRIS event detail page.
--
-- CONTEXT:
--   The approved detail page design renders each event_update as a typed
--   timeline entry with:
--     [type icon]  Bold headline
--                  Content body (1-2 sentences)
--                  Xm ago • Source Name
--
--   Type icons and color coding differ per update_type:
--     confirmed          → green filled circle   (high confidence)
--     official           → blue filled circle    (authority statement)
--     report             → grey circle            (standard report, default)
--     witness            → grey circle with dot   (eyewitness account)
--     under_verification → verification/hourglass (unverified early signal)
--     analysis           → text/quote icon        (contextual analysis)
--     correction         → correction icon        (amends a prior update)
--
--   The headline is a short bold title, distinct from the full content body.
--   When populated, headline renders on one line above content.
--   When NULL, frontend uses update_type label or derives text from content.
--
-- CHANGES:
--
-- 1. event_updates.update_type TEXT NOT NULL DEFAULT 'report'
--    Classifies the nature of the update. See values above.
--    Existing rows default to 'report' (the neutral classification).
--    CHECK constraint enforces the closed vocabulary.
--
-- 2. event_updates.headline TEXT (nullable)
--    Short, single-line title for the update.
--    Populated by the ingestion pipeline for structured feed items.
--    NULL for updates ingested before this migration (fine — frontend falls back).
--
-- 3. Index on update_type
--    Supports efficient filtering by type if needed (e.g. "show only confirmed
--    updates" as a future filter feature). Lightweight; update_type is low-cardinality.
--
-- NOTE:
--    ingest_event() is updated in migration 027 to accept update_type and
--    headline per update from the JSONB payload, along with image_url and
--    summary from migration 025. All ingest_event changes are consolidated
--    into one migration to avoid intermediate states where the DB schema
--    and function signature are mismatched.
--
-- NO DATA MIGRATION:
--    Existing rows default to update_type='report' and headline=NULL.
--    These are correct neutral values — no backfill needed.


-- ── 1. Add update_type column ─────────────────────────────────────────────────

ALTER TABLE public.event_updates
  ADD COLUMN update_type TEXT NOT NULL DEFAULT 'report'
    CONSTRAINT chk_event_updates_update_type
    CHECK (update_type IN (
      'report',
      'witness',
      'official',
      'confirmed',
      'under_verification',
      'analysis',
      'correction'
    ));


-- ── 2. Add headline column ────────────────────────────────────────────────────

ALTER TABLE public.event_updates
  ADD COLUMN headline TEXT;


-- ── 3. Index for update_type filtering ───────────────────────────────────────

CREATE INDEX idx_event_updates_update_type
  ON public.event_updates (event_id, update_type);
