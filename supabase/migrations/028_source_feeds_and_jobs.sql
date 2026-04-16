-- 028_source_feeds_and_jobs.sql
--
-- Introduces the source feed registry and ingestion job tracking tables.
-- These are the operational foundation for Phase 2 RSS ingestion.
--
-- TABLES:
--
-- 1. public.source_feeds
--    Registry of all configured polling sources (RSS feeds, official pages).
--    Managed exclusively by service_role (ingestion scripts, admin tooling).
--    Public read: users can see what sources IRIS monitors.
--
--    Key fields:
--      feed_url + slug must be unique.
--      credibility_score drives source_score for events ingested from this feed.
--      health_score degrades on consecutive fetch failures, resets on success.
--      linked_source_id optionally links to public.sources for the entity
--        identity and credibility record (e.g., "Reuters" as a source entity).
--
-- 2. public.ingestion_jobs
--    Immutable log of every fetch/normalize/process job attempt.
--    Service_role only — never exposed to clients.
--    Records are append-only: status transitions (pending→running→done/failed)
--    are captured as new state on the same row.
--
-- RLS:
--   source_feeds: public SELECT, RESTRICTIVE deny for INSERT/UPDATE/DELETE.
--   ingestion_jobs: RESTRICTIVE deny for all non-service roles.


-- ── 1. source_feeds ────────────────────────────────────────────────────────

CREATE TABLE public.source_feeds (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name                  TEXT        NOT NULL,
  slug                  TEXT        NOT NULL,      -- machine-readable key, e.g. 'reuters-world'

  -- Source classification
  source_type           TEXT        NOT NULL DEFAULT 'media_rss'
                                    CHECK (source_type IN ('media_rss', 'official_rss', 'official_page')),
  feed_url              TEXT        NOT NULL,      -- RSS/Atom URL or page URL
  homepage_url          TEXT,

  -- Geographic / categorical scope
  country_code          TEXT,                      -- ISO 3166-1 alpha-2, e.g. 'US', 'GB'
  region_scope          TEXT        NOT NULL DEFAULT 'global'
                                    CHECK (region_scope IN ('global', 'regional', 'local')),
  default_category      TEXT,                      -- e.g. 'world', 'disaster', 'conflict'

  -- Trust / credibility
  reliability_tier      TEXT        NOT NULL DEFAULT 'medium'
                                    CHECK (reliability_tier IN ('low', 'medium', 'high', 'official')),
  -- credibility_score feeds into source_score on events ingested from this feed.
  -- Range 0–100; 60 = competent media, 80 = major wire service, 90+ = official authority.
  credibility_score     INTEGER     NOT NULL DEFAULT 60
                                    CHECK (credibility_score >= 0 AND credibility_score <= 100),

  -- Polling config
  poll_interval_seconds INTEGER     NOT NULL DEFAULT 300    -- 5 minutes default
                                    CHECK (poll_interval_seconds >= 60),
  parser_type           TEXT        NOT NULL DEFAULT 'rss2'
                                    CHECK (parser_type IN ('rss2', 'atom', 'json_feed', 'html_page')),

  -- Operational state
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  last_fetched_at       TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error_message    TEXT,
  -- health_score: 100 = healthy; decrements by 10 per consecutive failure,
  -- resets to 100 on success. Feeds with health_score < 30 are skipped.
  health_score          INTEGER     NOT NULL DEFAULT 100
                                    CHECK (health_score >= 0 AND health_score <= 100),

  -- Optional link to public.sources entity (e.g., the Reuters source record)
  linked_source_id      UUID        REFERENCES public.sources(id) ON DELETE SET NULL,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed URL must be globally unique (same feed cannot be registered twice)
CREATE UNIQUE INDEX idx_source_feeds_feed_url ON public.source_feeds (feed_url);

-- Slug is a stable machine-readable key
CREATE UNIQUE INDEX idx_source_feeds_slug     ON public.source_feeds (slug);

-- Active feeds due for polling: WHERE is_active AND health_score >= 30
CREATE INDEX idx_source_feeds_active
  ON public.source_feeds (is_active, health_score DESC, last_fetched_at NULLS FIRST);


-- ── 2. ingestion_jobs ──────────────────────────────────────────────────────

CREATE TABLE public.ingestion_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Job classification
  job_type        TEXT        NOT NULL DEFAULT 'feed_poll'
                              CHECK (job_type IN ('feed_poll', 'normalize', 'process', 'full_pipeline')),
  source_feed_id  UUID        REFERENCES public.source_feeds(id) ON DELETE SET NULL,

  -- Lifecycle
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'running', 'done', 'failed', 'skipped')),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,

  -- Results
  items_found     INTEGER     NOT NULL DEFAULT 0,
  items_inserted  INTEGER     NOT NULL DEFAULT 0,
  items_skipped   INTEGER     NOT NULL DEFAULT 0,
  error_message   TEXT,

  -- Arbitrary structured metadata (e.g., fetch URL, item count by status)
  metadata        JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recent jobs per feed (for health monitoring and retry logic)
CREATE INDEX idx_ingestion_jobs_feed_recent
  ON public.ingestion_jobs (source_feed_id, created_at DESC)
  WHERE source_feed_id IS NOT NULL;

-- Failed jobs for retry scanning
CREATE INDEX idx_ingestion_jobs_failed
  ON public.ingestion_jobs (status, created_at DESC)
  WHERE status = 'failed';


-- ── 3. RLS ─────────────────────────────────────────────────────────────────

ALTER TABLE public.source_feeds ENABLE ROW LEVEL SECURITY;

-- Public read: source feed list is informational / transparency-first
CREATE POLICY source_feeds_read_all
  ON public.source_feeds FOR SELECT
  USING (true);

-- RESTRICTIVE deny for all client roles
CREATE POLICY deny_source_feeds_insert
  ON public.source_feeds AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

CREATE POLICY deny_source_feeds_update
  ON public.source_feeds AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);

CREATE POLICY deny_source_feeds_delete
  ON public.source_feeds AS RESTRICTIVE FOR DELETE
  USING (false);


ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;

-- ingestion_jobs is internal operational data — never exposed to clients
CREATE POLICY deny_jobs_select
  ON public.ingestion_jobs AS RESTRICTIVE FOR SELECT
  USING (false);

CREATE POLICY deny_jobs_insert
  ON public.ingestion_jobs AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

CREATE POLICY deny_jobs_update
  ON public.ingestion_jobs AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);

CREATE POLICY deny_jobs_delete
  ON public.ingestion_jobs AS RESTRICTIVE FOR DELETE
  USING (false);
