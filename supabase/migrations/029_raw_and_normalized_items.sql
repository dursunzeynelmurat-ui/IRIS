-- 029_raw_and_normalized_items.sql
--
-- Introduces the two-stage item storage layer for the ingestion pipeline.
--
-- PIPELINE STAGE:
--   source_feeds → [fetch] → raw_source_items → [normalize] → normalized_source_items
--                                                               ↓
--                                                        [match/cluster]
--                                                               ↓
--                                                    events / event_updates
--
-- TABLES:
--
-- 1. public.raw_source_items
--    One row per unique item fetched from a source feed.
--    Deduplication occurs at this layer: identical external_id within the same
--    feed is rejected; duplicate content_hash is also caught.
--    fetch_status tracks pipeline progress: raw → normalized → matched/skipped.
--
-- 2. public.normalized_source_items
--    One row per normalized raw item (1:1 with raw_source_items).
--    Contains cleaned text, extracted metadata, computed dedupe_signature, and
--    the matched_event_id after clustering.
--    This is the canonical pre-event record — the authoritative source of
--    information that flows into event rows.
--
-- RLS:
--    Both tables are internal pipeline state — no client access.
--    RESTRICTIVE deny for all non-service roles.
--    service_role bypasses RLS for all reads/writes.


-- ── 1. raw_source_items ────────────────────────────────────────────────────

CREATE TABLE public.raw_source_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_feed_id    UUID        NOT NULL REFERENCES public.source_feeds(id) ON DELETE CASCADE,

  -- Source item identity
  external_id       TEXT,                    -- RSS <guid>, Atom <id>, or URL
  source_url        TEXT,                    -- canonical link to the original article/page

  -- Raw content as received from the feed
  raw_title         TEXT,
  raw_summary       TEXT,                    -- <description> in RSS, <summary> in Atom
  raw_content       TEXT,                    -- <content:encoded> or <content> if present
  raw_author        TEXT,
  raw_published_at  TIMESTAMPTZ,             -- pubDate / updated / published

  -- Full parsed payload for debugging / re-normalization
  raw_payload_json  JSONB,

  -- Deduplication: SHA-256 of (feed_url + source_url + raw_title).
  -- Catches identical items arriving via different guids.
  content_hash      TEXT,

  -- Pipeline state
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_status      TEXT        NOT NULL DEFAULT 'raw'
                                CHECK (fetch_status IN ('raw', 'normalized', 'matched', 'skipped', 'error'))
);

-- Primary dedup: same external_id within same feed (RSS guid uniqueness)
CREATE UNIQUE INDEX idx_raw_items_feed_extid
  ON public.raw_source_items (source_feed_id, external_id)
  WHERE external_id IS NOT NULL;

-- URL-level dedup: same article URL already fetched from this feed
CREATE INDEX idx_raw_items_source_url
  ON public.raw_source_items (source_url)
  WHERE source_url IS NOT NULL;

-- Content hash dedup: catches near-identical items with different guids
CREATE INDEX idx_raw_items_content_hash
  ON public.raw_source_items (content_hash)
  WHERE content_hash IS NOT NULL;

-- Pipeline worker: find items waiting to be normalized
CREATE INDEX idx_raw_items_pending_normalize
  ON public.raw_source_items (source_feed_id, fetched_at DESC)
  WHERE fetch_status = 'raw';


-- ── 2. normalized_source_items ─────────────────────────────────────────────

CREATE TABLE public.normalized_source_items (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One-to-one with raw item
  raw_source_item_id      UUID        NOT NULL UNIQUE
                                      REFERENCES public.raw_source_items(id) ON DELETE CASCADE,

  -- Cleaned content
  normalized_title        TEXT        NOT NULL,
  normalized_summary      TEXT,                    -- cleaned 1-3 sentence summary

  -- Metadata
  language_code           TEXT        NOT NULL DEFAULT 'en',
  category_candidate      TEXT,                    -- e.g. 'disaster', 'conflict', 'health'
  subcategory_candidate   TEXT,                    -- e.g. 'earthquake', 'flood', 'protest'

  -- Location (best-effort extraction from title/summary)
  country_code            TEXT,                    -- ISO 3166-1 alpha-2
  city                    TEXT,
  location_text           TEXT,                    -- raw location string e.g. "Baghdad, Iraq"
  latitude                DOUBLE PRECISION,
  longitude               DOUBLE PRECISION,

  -- Time
  occurred_at_estimate    TIMESTAMPTZ,             -- best estimate of when event occurred

  -- Extracted structure (JSONB arrays)
  -- entities_json: [{name: string, type: 'person'|'org'|'place'|'other'}]
  entities_json           JSONB,
  -- claims_json: [{claim: string, confidence: number}]
  claims_json             JSONB,
  -- keywords_json: string[]  (significant terms for matching)
  keywords_json           JSONB,

  -- Event matching
  -- dedupe_signature: sorted significant words for dedup/similarity
  -- Two items with the same signature are treated as duplicates.
  dedupe_signature        TEXT        NOT NULL,
  -- match_score: 0–100 similarity score against matched_event_id (if set)
  match_score             INTEGER,
  normalization_version   TEXT        NOT NULL DEFAULT '1',

  -- Result of clustering: which event this item was merged into
  matched_event_id        UUID        REFERENCES public.events(id) ON DELETE SET NULL,

  normalized_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Find normalized items not yet matched to an event (pending clustering)
CREATE INDEX idx_normalized_pending_match
  ON public.normalized_source_items (normalized_at DESC)
  WHERE matched_event_id IS NULL;

-- Look up all normalized items for a given event
CREATE INDEX idx_normalized_by_event
  ON public.normalized_source_items (matched_event_id)
  WHERE matched_event_id IS NOT NULL;

-- Dedupe signature index for fast near-duplicate detection
CREATE INDEX idx_normalized_dedupe_sig
  ON public.normalized_source_items (dedupe_signature);


-- ── 3. RLS ─────────────────────────────────────────────────────────────────
--
-- These are internal pipeline tables. No client has read or write access.
-- service_role (bypass RLS) is the only role that reads/writes these.

ALTER TABLE public.raw_source_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_raw_items_select
  ON public.raw_source_items AS RESTRICTIVE FOR SELECT
  USING (false);
CREATE POLICY deny_raw_items_insert
  ON public.raw_source_items AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);
CREATE POLICY deny_raw_items_update
  ON public.raw_source_items AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);
CREATE POLICY deny_raw_items_delete
  ON public.raw_source_items AS RESTRICTIVE FOR DELETE
  USING (false);


ALTER TABLE public.normalized_source_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY deny_normalized_select
  ON public.normalized_source_items AS RESTRICTIVE FOR SELECT
  USING (false);
CREATE POLICY deny_normalized_insert
  ON public.normalized_source_items AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);
CREATE POLICY deny_normalized_update
  ON public.normalized_source_items AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);
CREATE POLICY deny_normalized_delete
  ON public.normalized_source_items AS RESTRICTIVE FOR DELETE
  USING (false);
