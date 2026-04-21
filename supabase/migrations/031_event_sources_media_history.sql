-- 031_event_sources_media_history.sql
--
-- Three new tables to support the detail page intelligence surface:
--
-- 1. public.event_sources
--    Per-event source attribution: which source feeds cover this event,
--    with reliability tier and editorial stance (supports/contradicts/neutral).
--    Powers the Sources tab on the event detail page.
--    Distinct from public.sources (entity credibility registry) — event_sources
--    tracks per-event attribution while sources tracks persistent entity identity.
--
-- 2. public.event_media
--    Media attachments (images, video) per event.
--    The primary media record determines events.image_url via trigger.
--    RLS: public read, service_role write.
--
-- 3. public.event_score_history
--    Append-only score snapshots for sparkline rendering on the detail page.
--    Populated by the recompute_event_state() function (migration 033)
--    whenever trust_score or importance_score changes meaningfully.
--    RLS: public read, service_role write.
--
-- RELATIONSHIP TO EXISTING TABLES:
--   event_sources.source_feed_id → source_feeds (migration 028)
--   event_sources.normalized_source_item_id → normalized_source_items (migration 029)
--   event_sources.event_id → events
--   event_media.event_id → events
--   event_score_history.event_id → events


-- ── 1. event_sources ───────────────────────────────────────────────────────

CREATE TABLE public.event_sources (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  event_id                  UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  -- References to pipeline tables (nullable for manually-created sources)
  normalized_source_item_id UUID        REFERENCES public.normalized_source_items(id) ON DELETE SET NULL,
  source_feed_id            UUID        REFERENCES public.source_feeds(id)             ON DELETE SET NULL,

  -- Denormalized for query performance (display without joins)
  source_name               TEXT        NOT NULL,
  -- source_type aligned with both source_feeds types and legacy sources types
  source_type               TEXT        NOT NULL DEFAULT 'media_rss'
                                        CHECK (source_type IN (
                                          'media_rss', 'official_rss', 'official_page',
                                          -- legacy values from public.sources:
                                          'media', 'official', 'expert', 'community'
                                        )),
  source_url                TEXT,
  published_at              TIMESTAMPTZ,

  reliability_tier          TEXT        NOT NULL DEFAULT 'medium'
                                        CHECK (reliability_tier IN ('low', 'medium', 'high', 'official')),

  -- How does this source relate to the event's prevailing narrative?
  -- supports: this source's reporting aligns with the event record
  -- contradicts: this source disputes the event record (triggers conflict_flag)
  -- neutral: reporting without clear alignment
  stance                    TEXT        NOT NULL DEFAULT 'neutral'
                                        CHECK (stance IN ('supports', 'contradicts', 'neutral')),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One entry per source feed per event: prevents same feed being counted twice
  UNIQUE (event_id, source_feed_id)
);

-- Primary join: all sources for an event
CREATE INDEX idx_event_sources_event
  ON public.event_sources (event_id, reliability_tier, created_at DESC);

-- Lookup: which events mention this source feed
CREATE INDEX idx_event_sources_feed
  ON public.event_sources (source_feed_id)
  WHERE source_feed_id IS NOT NULL;

-- Contradiction detection: fast scan for conflicting sources
CREATE INDEX idx_event_sources_contradicts
  ON public.event_sources (event_id)
  WHERE stance = 'contradicts';

ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;

-- Sources tab on detail page: public read
CREATE POLICY event_sources_read_all
  ON public.event_sources FOR SELECT
  USING (true);

CREATE POLICY deny_event_sources_insert
  ON public.event_sources AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);
CREATE POLICY deny_event_sources_update
  ON public.event_sources AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);
CREATE POLICY deny_event_sources_delete
  ON public.event_sources AS RESTRICTIVE FOR DELETE
  USING (false);


-- ── 2. event_media ────────────────────────────────────────────────────────

CREATE TABLE public.event_media (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,

  -- Where this media lives
  source_url    TEXT        NOT NULL,    -- original source URL
  media_type    TEXT        NOT NULL DEFAULT 'image'
                            CHECK (media_type IN ('image', 'video', 'audio', 'document')),

  -- Processed/stored references (populated when media is mirrored/processed)
  image_url     TEXT,                   -- stable stored URL for the full image
  thumbnail_url TEXT,                   -- lower-res thumbnail

  caption       TEXT,
  source_name   TEXT,                   -- which source provided this media

  -- Primary image: when true, drives events.image_url via trigger
  is_primary    BOOLEAN     NOT NULL DEFAULT false,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Constraint: only one primary media per event
CREATE UNIQUE INDEX idx_event_media_primary
  ON public.event_media (event_id)
  WHERE is_primary = true;

-- All media for an event
CREATE INDEX idx_event_media_event
  ON public.event_media (event_id, is_primary DESC, created_at);

ALTER TABLE public.event_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_media_read_all
  ON public.event_media FOR SELECT
  USING (true);

CREATE POLICY deny_event_media_insert
  ON public.event_media AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);
CREATE POLICY deny_event_media_update
  ON public.event_media AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);
CREATE POLICY deny_event_media_delete
  ON public.event_media AS RESTRICTIVE FOR DELETE
  USING (false);


-- ── 3. event_score_history ────────────────────────────────────────────────
--
-- Append-only score snapshots. Never deleted or updated.
-- The recompute_event_state() function (migration 033) appends here whenever
-- scores change meaningfully (> ±2 points to avoid trivial noise).

CREATE TABLE public.event_score_history (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  trust_score      INTEGER     NOT NULL
                               CHECK (trust_score >= 0 AND trust_score <= 100),
  importance_score INTEGER     NOT NULL DEFAULT 50
                               CHECK (importance_score >= 0 AND importance_score <= 100),
  -- Snapshot of status at this point in time (useful for audit/debugging)
  status_snapshot  TEXT,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sparkline query: all history for an event, newest first
CREATE INDEX idx_score_history_event_time
  ON public.event_score_history (event_id, recorded_at DESC);

-- Pruning: delete old history (retention policy applied by maintenance job)
CREATE INDEX idx_score_history_recorded_at
  ON public.event_score_history (recorded_at DESC);

ALTER TABLE public.event_score_history ENABLE ROW LEVEL SECURITY;

-- Sparkline data: public read
CREATE POLICY event_score_history_read_all
  ON public.event_score_history FOR SELECT
  USING (true);

CREATE POLICY deny_score_history_insert
  ON public.event_score_history AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);
CREATE POLICY deny_score_history_update
  ON public.event_score_history AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);
CREATE POLICY deny_score_history_delete
  ON public.event_score_history AS RESTRICTIVE FOR DELETE
  USING (false);
