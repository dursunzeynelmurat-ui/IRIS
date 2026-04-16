-- 030_extend_events.sql
--
-- Extends the events table for Phase 2 with:
--   a) Expanded status vocabulary aligned with event lifecycle
--   b) Operational metadata: slug, category, visibility, scope
--   c) Scoring columns: importance_score, feed_rank
--   d) Location columns: country_codes, region_tags, city, lat, lon
--   e) Lifecycle tracking: first_seen_at, last_updated_at, update_count
--   f) Flags: official_confirmation, conflict_flag
--
-- STATUS VOCABULARY CHANGE:
--   Old: emerging | developing | verified | disputed
--   New: new | developing | verified | conflicted | contained | resolved | archived
--
--   Mapping for existing data:
--     'emerging' → 'new'         (first sighting, minimal confirmation)
--     'disputed' → 'conflicted'  (contradictory source reporting)
--     'developing' and 'verified' stay the same.
--
--   New values:
--     'contained'  — situation controlled, no longer spreading
--     'resolved'   — confirmed resolution/closure
--     'archived'   — no longer surfaced in feed (stale or low-value)
--
-- The old CHECK constraint is expanded to allow both old and new values
-- during the data migration window. Migration 033 (scoring functions) removes
-- the old values from the constraint once all data has been converted.
--
-- FIELD NOTES:
--   slug          — URL-safe identifier derived from title + short UUID.
--                   Nullable; populated by ingestion pipeline. Unique where set.
--   visibility    — Controls feed surfacing independently of status.
--                   visible: appears in all feed modes
--                   low_visibility: appears only in direct search/link
--                   hidden_pending_review: queued for editorial review
--                   archived: removed from all feeds
--   importance_score — 0–100, separate from trust. Trust = "is this true?";
--                   importance = "does this matter operationally?". A highly
--                   verified but trivial event should not dominate the feed.
--   feed_rank     — Pre-computed weighted composite for feed ordering.
--                   Recomputed by recompute_event_state() (migration 033).
--   first_seen_at — Timestamp of the first source item that created this event.
--                   Back-filled to created_at for existing events.
--   last_updated_at — Alias pattern for when event metadata last changed.
--                   Different from latest_update_at (which tracks update rows).
--                   Back-filled to COALESCE(latest_update_at, created_at).
--   update_count  — Count of VISIBLE event_updates. Incremented by trigger
--                   added in migration 033. Back-filled to source_count.
--   official_confirmation — True when at least one source with
--                   reliability_tier='official' or update_type='official_confirmation'
--                   is linked to this event.
--   conflict_flag — True when at least one event_source has stance='contradicts'.


-- ── 1. Expand status CHECK (allows old + new values during migration) ──────

ALTER TABLE public.events
  DROP CONSTRAINT events_status_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_status_check
  CHECK (status IN (
    -- new vocabulary
    'new', 'developing', 'verified', 'conflicted', 'contained', 'resolved', 'archived',
    -- old values retained for migration window; removed in migration 033
    'emerging', 'disputed'
  ));


-- ── 2. Data migration: rename old status values ────────────────────────────

UPDATE public.events SET status = 'new'        WHERE status = 'emerging';
UPDATE public.events SET status = 'conflicted' WHERE status = 'disputed';


-- ── 3. Add new columns ─────────────────────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN slug               TEXT,
  ADD COLUMN category           TEXT,                      -- e.g. 'disaster', 'conflict', 'health'
  ADD COLUMN subcategory        TEXT,                      -- e.g. 'earthquake', 'wildfire', 'protest'

  ADD COLUMN visibility         TEXT    NOT NULL DEFAULT 'visible'
                                        CHECK (visibility IN (
                                          'visible', 'low_visibility',
                                          'hidden_pending_review', 'archived'
                                        )),

  ADD COLUMN scope              TEXT    NOT NULL DEFAULT 'global'
                                        CHECK (scope IN ('global', 'regional', 'local')),

  ADD COLUMN importance_score   INTEGER NOT NULL DEFAULT 50
                                        CHECK (importance_score >= 0 AND importance_score <= 100),

  -- feed_rank: pre-computed weighted composite for feed ordering.
  -- NUMERIC(8,4) gives plenty of precision for the weighted formula.
  ADD COLUMN feed_rank          NUMERIC(8,4) NOT NULL DEFAULT 0,

  -- Location arrays: multiple country codes for multi-country events
  ADD COLUMN country_codes      TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN region_tags        TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN city               TEXT,
  ADD COLUMN latitude           DOUBLE PRECISION,
  ADD COLUMN longitude          DOUBLE PRECISION,

  -- Lifecycle tracking
  ADD COLUMN first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- last_updated_at: when event metadata last changed (vs latest_update_at which
  -- tracks the most recent update row for "Xm ago" display)
  ADD COLUMN last_updated_at    TIMESTAMPTZ,

  -- update_count: count of visible event_updates for this event
  ADD COLUMN update_count       INTEGER NOT NULL DEFAULT 0,

  -- Binary flags for fast feed filtering
  ADD COLUMN official_confirmation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN conflict_flag         BOOLEAN NOT NULL DEFAULT false;


-- ── 4. Back-fill derived columns ───────────────────────────────────────────

-- first_seen_at = original creation time
UPDATE public.events
  SET first_seen_at = created_at;

-- last_updated_at = most recent update or creation time
UPDATE public.events
  SET last_updated_at = COALESCE(latest_update_at, created_at);

-- update_count starts equal to source_count (both count event_update rows)
UPDATE public.events
  SET update_count = source_count;

-- Populate slug: lowercase title → replace non-alphanumeric → append short UUID
UPDATE public.events
  SET slug = lower(regexp_replace(trim(title), '[^a-zA-Z0-9]+', '-', 'g'))
             || '-' || substr(id::text, 1, 8);


-- ── 5. Indexes ─────────────────────────────────────────────────────────────

-- Slug lookup (unique where not null)
CREATE UNIQUE INDEX idx_events_slug
  ON public.events (slug)
  WHERE slug IS NOT NULL;

-- Feed ranking index (primary sort for the feed)
CREATE INDEX idx_events_feed_rank
  ON public.events (feed_rank DESC, last_updated_at DESC NULLS LAST)
  WHERE visibility = 'visible';

-- Importance score index
CREATE INDEX idx_events_importance
  ON public.events (importance_score DESC);

-- Category filtering
CREATE INDEX idx_events_category
  ON public.events (category)
  WHERE category IS NOT NULL;

-- Official-confirmed events fast path
CREATE INDEX idx_events_official
  ON public.events (official_confirmation, trust_score DESC)
  WHERE official_confirmation = true;
