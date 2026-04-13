-- 023_source_reliability.sql
--
-- Introduces structured source entities and separates trust into three
-- explicit, independently maintained score columns on events.
--
-- PROBLEM:
--   trust_score is currently 100% crowd-derived: it equals
--   ROUND(confirms / total * 100). A crowd of users can push trust_score to
--   0 or 100 with no regard for the actual quality of the underlying sources.
--   IRIS is a verification platform — source reliability must be the primary
--   driver of trust, with community signals as a minor adjustment only.
--
-- CHANGES:
--
-- 1. public.sources
--    Source identity and credibility. Managed by service_role only.
--    credibility (0–100) is the primary data point; higher = more reliable.
--    source_type classifies the source (media, official, expert, community).
--    verified marks whether a source has been formally vetted.
--
-- 2. event_updates.source_id FK (nullable)
--    Links a timeline update to a structured source entity.
--    Nullable for backward compatibility — existing updates without a
--    matched source continue to work; source_id is populated progressively.
--
-- 3. events.source_score INTEGER DEFAULT 50
--    Source-credibility-weighted trust component.
--    Computed as AVG(sources.credibility) across linked sources for this event.
--    Defaults to 50 (neutral) when no updates are linked to a structured source.
--
-- 4. events.crowd_score INTEGER DEFAULT 50
--    Pure crowd-signal component. Same confirm-ratio formula as the old
--    trust_score. Renamed to make the separation explicit.
--    Defaults to 50 (neutral/no crowd data).
--
-- 5. events.trust_score (semantics change)
--    Composite final score:
--      trust_score = clamp(source_score + (crowd_score - 50) * 0.2, 0, 100)
--    Crowd can shift trust by at most ±10 points relative to source_score.
--    Source quality remains the dominant factor.
--
-- DATA MIGRATION (existing events):
--    a. Copy current trust_score (crowd-derived) → crowd_score
--    b. source_score = 50 (neutral; no sources linked yet for any event)
--    c. Recompute trust_score = clamp(50 + (crowd_score - 50) * 0.2, 0, 100)
--
--    Examples after migration:
--      old trust_score=100 → crowd=100, source=50, trust=60
--      old trust_score=  0 → crowd=  0, source=50, trust=40
--      old trust_score= 75 → crowd= 75, source=50, trust=55
--      old trust_score= 50 → crowd= 50, source=50, trust=50
--
-- RLS on sources:
--    Public read (sources are informational).
--    All writes blocked for authenticated + anon — service_role only.
--    (service_role BYPASSES RLS, so RESTRICTIVE deny policies don't apply to it.)
--
-- NOTE:
--    Scoring functions and trigger updates are in migration 024.
--    This migration covers schema + RLS + data only.

-- ── 1. public.sources ─────────────────────────────────────────────────────

CREATE TABLE public.sources (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  domain       TEXT,                        -- e.g. 'reuters.com', used for dedup/linkage
  credibility  INTEGER     NOT NULL DEFAULT 50
                           CHECK (credibility >= 0 AND credibility <= 100),
  source_type  TEXT        NOT NULL DEFAULT 'media'
                           CHECK (source_type IN ('media', 'official', 'expert', 'community')),
  verified     BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive unique name: prevents duplicate source entries.
CREATE UNIQUE INDEX idx_sources_name_lower ON public.sources (lower(name));

-- Fast domain lookup (for future linkage from ingestion scripts).
CREATE INDEX idx_sources_domain ON public.sources (domain)
  WHERE domain IS NOT NULL;


-- ── 2. event_updates.source_id ─────────────────────────────────────────────
--
-- ON DELETE SET NULL: if a source record is removed, the update is preserved
-- but loses its source link rather than being cascade-deleted. Source removal
-- is rare and should not silently remove event history.

ALTER TABLE public.event_updates
  ADD COLUMN source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL;

CREATE INDEX idx_event_updates_source_id ON public.event_updates (source_id)
  WHERE source_id IS NOT NULL;


-- ── 3. events.source_score + crowd_score ──────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN source_score INTEGER NOT NULL DEFAULT 50
             CHECK (source_score >= 0 AND source_score <= 100),
  ADD COLUMN crowd_score  INTEGER NOT NULL DEFAULT 50
             CHECK (crowd_score  >= 0 AND crowd_score  <= 100);


-- ── 4. Data migration ─────────────────────────────────────────────────────
--
-- Step a: crowd_score = existing trust_score (it was crowd-derived).
-- Step b: source_score stays 50 (default; no sources linked yet).
-- Step c: trust_score = clamp(50 + (crowd_score - 50) * 0.2, 0, 100).
--
-- The inline formula mirrors compute_trust_score from migration 024.
-- Using inline SQL here avoids a cross-migration function dependency.

UPDATE public.events
  SET crowd_score = trust_score;

UPDATE public.events
  SET trust_score = GREATEST(0, LEAST(100,
    ROUND(50 + (crowd_score - 50) * 0.2)::INTEGER
  ));


-- ── 5. RLS on sources ─────────────────────────────────────────────────────

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

-- Public read: source credibility is informational, visible to everyone.
CREATE POLICY sources_read_all
  ON public.sources FOR SELECT
  USING (true);

-- RESTRICTIVE deny policies block writes for all roles.
-- service_role has BYPASSRLS and is unaffected.

CREATE POLICY deny_sources_insert
  ON public.sources AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

CREATE POLICY deny_sources_update
  ON public.sources AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);

CREATE POLICY deny_sources_delete
  ON public.sources AS RESTRICTIVE FOR DELETE
  USING (false);


-- ── 6. get_event_sources RPC ──────────────────────────────────────────────
--
-- Returns the structured sources linked to an event via event_updates.
-- Used by the frontend for Source Credibility and Referenced Sources display.
--
-- update_count: number of timeline updates from this source for the event.
-- SECURITY INVOKER: RLS on event_updates and sources applies (both public read).
-- Returns empty set if no updates are linked to structured sources.

CREATE OR REPLACE FUNCTION public.get_event_sources(p_event_id UUID)
RETURNS TABLE (
  source_id    UUID,
  name         TEXT,
  domain       TEXT,
  credibility  INTEGER,
  source_type  TEXT,
  verified     BOOLEAN,
  update_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.id            AS source_id,
    s.name,
    s.domain,
    s.credibility,
    s.source_type,
    s.verified,
    COUNT(eu.id)    AS update_count
  FROM public.event_updates eu
  JOIN public.sources s ON s.id = eu.source_id
  WHERE eu.event_id = p_event_id
  GROUP BY s.id, s.name, s.domain, s.credibility, s.source_type, s.verified
  ORDER BY s.credibility DESC, COUNT(eu.id) DESC;
$$;
