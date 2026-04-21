-- 034_app_views_and_rpcs.sql
--
-- App-facing query layer for the event detail page and supporting data.
--
-- FUNCTIONS:
--   get_event_detail(event_id)           — Full event detail with updates + sources
--   get_event_score_history(event_id, hours_back) — Sparkline data
--   get_event_sources_detail(event_id)   — Enhanced source listing with feed context
--   create_event_for_item(normalized_item_id) — Pipeline: create event from normalized item
--   attach_item_to_event(normalized_item_id, event_id, match_score) — Pipeline: attach to event
--
-- RATIONALE FOR RPCs vs. CLIENT JOINS:
--   The event detail screen needs data from multiple tables (events + event_updates
--   + event_sources + event_score_history). Fetching these separately produces N+1
--   queries. A single RPC returns everything in one round-trip and is easier to
--   cache at the Supabase edge.
--
--   The pipeline functions (create_event_for_item, attach_item_to_event) encapsulate
--   the matching→event→update creation logic server-side with correct locking and
--   atomicity guarantees.


-- ── 1. get_event_detail ───────────────────────────────────────────────────
--
-- Returns full event detail as structured JSON.
-- The response is deliberately flat (not nested JSONB) so PostgREST/Supabase
-- client can handle it simply. Updates and sources are returned as separate
-- RPC calls (see client usage notes below).
--
-- Returns one row per event (or zero rows if not found).

CREATE OR REPLACE FUNCTION public.get_event_detail(p_event_id UUID)
RETURNS TABLE (
  id                    UUID,
  slug                  TEXT,
  title                 TEXT,
  summary               TEXT,
  image_url             TEXT,
  status                TEXT,
  visibility            TEXT,
  category              TEXT,
  subcategory           TEXT,
  scope                 TEXT,
  trust_score           INTEGER,
  importance_score      INTEGER,
  source_score          INTEGER,
  crowd_score           INTEGER,
  feed_rank             NUMERIC,
  source_count          INTEGER,
  update_count          INTEGER,
  follow_count          INTEGER,
  official_confirmation BOOLEAN,
  conflict_flag         BOOLEAN,
  country_codes         TEXT[],
  region_tags           TEXT[],
  city                  TEXT,
  latitude              DOUBLE PRECISION,
  longitude             DOUBLE PRECISION,
  first_seen_at         TIMESTAMPTZ,
  last_updated_at       TIMESTAMPTZ,
  latest_update_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    e.id, e.slug, e.title, e.summary, e.image_url,
    e.status, e.visibility, e.category, e.subcategory, e.scope,
    e.trust_score, e.importance_score, e.source_score, e.crowd_score, e.feed_rank,
    e.source_count, e.update_count, e.follow_count,
    e.official_confirmation, e.conflict_flag,
    e.country_codes, e.region_tags, e.city, e.latitude, e.longitude,
    e.first_seen_at, e.last_updated_at, e.latest_update_at, e.created_at
  FROM public.events e
  WHERE e.id = p_event_id;
$$;

-- No REVOKE: public read, same access level as events table.


-- ── 2. get_event_updates_for_detail ───────────────────────────────────────
--
-- Returns visible updates for the event detail timeline, ordered for display.
-- Uses display_order_time (explicit ordering) or published_at or created_at.
-- Includes Phase 2 fields: update_type, headline, confidence, published_at.

CREATE OR REPLACE FUNCTION public.get_event_updates_for_detail(
  p_event_id UUID,
  p_limit    INTEGER DEFAULT 50
)
RETURNS TABLE (
  id            UUID,
  event_id      UUID,
  update_type   TEXT,
  headline      TEXT,
  content       TEXT,
  source_name   TEXT,
  source_url    TEXT,
  confidence    INTEGER,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    eu.id, eu.event_id,
    eu.update_type, eu.headline, eu.content,
    eu.source_name, eu.source_url, eu.confidence,
    COALESCE(eu.published_at, eu.created_at) AS published_at,
    eu.created_at
  FROM public.event_updates eu
  WHERE eu.event_id = p_event_id
    AND eu.is_visible = true
  ORDER BY COALESCE(eu.display_order_time, eu.published_at, eu.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;


-- ── 3. get_event_score_history ────────────────────────────────────────────
--
-- Returns score snapshots for sparkline rendering on the detail page.
-- p_hours_back: look back this many hours (default 24h).
-- Returns up to 48 data points ordered oldest-first (correct for chart rendering).

CREATE OR REPLACE FUNCTION public.get_event_score_history(
  p_event_id   UUID,
  p_hours_back INTEGER DEFAULT 24
)
RETURNS TABLE (
  trust_score      INTEGER,
  importance_score INTEGER,
  recorded_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    h.trust_score,
    h.importance_score,
    h.recorded_at
  FROM public.event_score_history h
  WHERE h.event_id = p_event_id
    AND h.recorded_at >= NOW() - (COALESCE(p_hours_back, 24) || ' hours')::INTERVAL
  ORDER BY h.recorded_at ASC
  LIMIT 48;
$$;


-- ── 4. get_event_sources_detail ───────────────────────────────────────────
--
-- Returns the sources tab data for the event detail page.
-- Includes reliability tier, stance, and publication time.
-- Falls back gracefully when source_feed details are unavailable.

CREATE OR REPLACE FUNCTION public.get_event_sources_detail(p_event_id UUID)
RETURNS TABLE (
  id               UUID,
  source_name      TEXT,
  source_type      TEXT,
  source_url       TEXT,
  reliability_tier TEXT,
  stance           TEXT,
  published_at     TIMESTAMPTZ,
  credibility_score INTEGER,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    es.id,
    es.source_name,
    es.source_type,
    es.source_url,
    es.reliability_tier,
    es.stance,
    es.published_at,
    COALESCE(sf.credibility_score, 60) AS credibility_score,
    es.created_at
  FROM public.event_sources es
  LEFT JOIN public.source_feeds sf ON sf.id = es.source_feed_id
  WHERE es.event_id = p_event_id
  ORDER BY
    -- Official sources first, then by reliability tier, then by time
    CASE es.reliability_tier
      WHEN 'official' THEN 1
      WHEN 'high'     THEN 2
      WHEN 'medium'   THEN 3
      WHEN 'low'      THEN 4
      ELSE 5
    END,
    COALESCE(es.published_at, es.created_at) DESC;
$$;


-- ── 5. create_event_for_item ──────────────────────────────────────────────
--
-- Pipeline function: creates a new event from a normalized source item.
-- Called by the TypeScript matching worker when no matching event is found.
--
-- Creates:
--   1. events row (populated from normalized item metadata)
--   2. event_updates row (first_report type)
--   3. event_sources row (linking this source to the new event)
--   4. Updates normalized_source_items.matched_event_id
--   5. Updates raw_source_items.fetch_status = 'matched'
--
-- Returns the new event UUID.

CREATE OR REPLACE FUNCTION public.create_event_for_item(
  p_normalized_item_id UUID,
  p_source_feed_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm        public.normalized_source_items%ROWTYPE;
  v_raw         public.raw_source_items%ROWTYPE;
  v_feed        public.source_feeds%ROWTYPE;
  v_event_id    UUID;
  v_slug        TEXT;
  v_status      TEXT := 'new';
  v_image_url   TEXT;
BEGIN
  -- Load normalized item
  SELECT * INTO v_norm
  FROM public.normalized_source_items
  WHERE id = p_normalized_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_event_for_item: normalized item % not found', p_normalized_item_id;
  END IF;
  IF v_norm.matched_event_id IS NOT NULL THEN
    -- Already matched to an event; return existing
    RETURN v_norm.matched_event_id;
  END IF;

  -- Load raw item
  SELECT * INTO v_raw
  FROM public.raw_source_items
  WHERE id = v_norm.raw_source_item_id;

  -- Load feed config (NULL-safe)
  IF p_source_feed_id IS NOT NULL THEN
    SELECT * INTO v_feed FROM public.source_feeds WHERE id = p_source_feed_id;
  END IF;

  -- Derive slug from normalized title
  v_slug := lower(regexp_replace(trim(v_norm.normalized_title), '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(gen_random_uuid()::text, 1, 8);

  -- Derive initial image from raw content if present
  v_image_url := NULL; -- TypeScript pipeline sets this via event_media

  -- If source is official, start at 'developing' with higher trust
  IF v_feed.reliability_tier = 'official' THEN
    v_status := 'developing';
  END IF;

  -- Concurrency guard (advisory lock on normalized title to prevent duplicate events)
  PERFORM pg_advisory_xact_lock(43, hashtext(lower(v_norm.normalized_title)));

  -- Double-check no matching event appeared while we waited for the lock
  IF v_norm.matched_event_id IS NOT NULL THEN
    RETURN v_norm.matched_event_id;
  END IF;

  -- Create event
  INSERT INTO public.events (
    title, summary, status, image_url, slug,
    category, subcategory,
    country_codes, city, latitude, longitude,
    first_seen_at, last_updated_at
  ) VALUES (
    v_norm.normalized_title,
    v_norm.normalized_summary,
    v_status,
    v_image_url,
    v_slug,
    v_norm.category_candidate,
    v_norm.subcategory_candidate,
    CASE WHEN v_norm.country_code IS NOT NULL THEN ARRAY[v_norm.country_code] ELSE '{}' END,
    v_norm.city,
    v_norm.latitude,
    v_norm.longitude,
    COALESCE(v_norm.occurred_at_estimate, v_raw.raw_published_at, NOW()),
    NOW()
  ) RETURNING id INTO v_event_id;

  -- Create first_report update
  INSERT INTO public.event_updates (
    event_id,
    content,
    source_name,
    source_url,
    update_type,
    headline,
    published_at,
    display_order_time,
    is_visible,
    confidence
  ) VALUES (
    v_event_id,
    COALESCE(v_norm.normalized_summary, v_norm.normalized_title),
    COALESCE(v_feed.name, v_raw.raw_author, 'Unknown source'),
    v_raw.source_url,
    'first_report',
    v_norm.normalized_title,
    COALESCE(v_norm.occurred_at_estimate, v_raw.raw_published_at),
    COALESCE(v_norm.occurred_at_estimate, v_raw.raw_published_at, NOW()),
    true,
    CASE v_feed.reliability_tier
      WHEN 'official' THEN 90
      WHEN 'high'     THEN 80
      WHEN 'medium'   THEN 65
      ELSE 50
    END
  );

  -- Create event_source record
  IF v_feed.id IS NOT NULL THEN
    INSERT INTO public.event_sources (
      event_id, normalized_source_item_id, source_feed_id,
      source_name, source_type, source_url,
      published_at, reliability_tier, stance
    ) VALUES (
      v_event_id, p_normalized_item_id, v_feed.id,
      v_feed.name,
      v_feed.source_type,
      v_raw.source_url,
      COALESCE(v_norm.occurred_at_estimate, v_raw.raw_published_at),
      COALESCE(v_feed.reliability_tier, 'medium'),
      'supports'
    )
    ON CONFLICT (event_id, source_feed_id) DO NOTHING;
  END IF;

  -- Mark normalized item as matched
  UPDATE public.normalized_source_items
  SET matched_event_id = v_event_id
  WHERE id = p_normalized_item_id;

  -- Mark raw item as matched
  UPDATE public.raw_source_items
  SET fetch_status = 'matched'
  WHERE id = v_norm.raw_source_item_id;

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_event_for_item(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_event_for_item(UUID, UUID) TO service_role;


-- ── 6. attach_item_to_event ───────────────────────────────────────────────
--
-- Pipeline function: attaches a normalized item to an existing event.
-- Called when the TypeScript matching worker finds a strong match.
--
-- Creates:
--   1. event_sources row (if not already from this feed)
--   2. Conditionally creates a visible event_update (see visibility rules)
--   3. Updates normalized_source_items.matched_event_id
--   4. Updates raw_source_items.fetch_status
--   5. Calls recompute_event_state for fresh scores
--
-- Visibility rules for new update:
--   - Skips if dedupe_signature matches an existing update (obvious duplicate)
--   - Creates visible update for update_types: official_confirmation, escalation,
--     deescalation, contradiction, denial, casualty_update, closure, location_refinement
--   - Creates low-confidence hidden update for generic repetitions

CREATE OR REPLACE FUNCTION public.attach_item_to_event(
  p_normalized_item_id UUID,
  p_event_id           UUID,
  p_match_score        INTEGER  DEFAULT 80,
  p_source_feed_id     UUID     DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm             public.normalized_source_items%ROWTYPE;
  v_raw              public.raw_source_items%ROWTYPE;
  v_feed             public.source_feeds%ROWTYPE;
  v_is_dup           BOOLEAN := false;
  v_update_type      TEXT    := 'generic_update';
  v_should_be_visible BOOLEAN := true;
  v_confidence       INTEGER := 65;
BEGIN
  SELECT * INTO v_norm
  FROM public.normalized_source_items
  WHERE id = p_normalized_item_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_norm.matched_event_id IS NOT NULL THEN RETURN; END IF;

  SELECT * INTO v_raw  FROM public.raw_source_items WHERE id = v_norm.raw_source_item_id;
  IF p_source_feed_id IS NOT NULL THEN
    SELECT * INTO v_feed FROM public.source_feeds WHERE id = p_source_feed_id;
  END IF;

  -- Dedupe check: does an update with the same signature already exist?
  SELECT EXISTS (
    SELECT 1 FROM public.event_updates eu
    JOIN public.normalized_source_items ni ON ni.id = eu.normalized_source_item_id
    WHERE eu.event_id = p_event_id
      AND ni.dedupe_signature = v_norm.dedupe_signature
  ) INTO v_is_dup;

  IF v_is_dup THEN
    -- Item is a duplicate of existing coverage — still attach but no update
    v_should_be_visible := false;
    v_update_type := 'generic_update';
  ELSE
    -- Determine update type and visibility from feed characteristics
    IF v_feed.reliability_tier = 'official' THEN
      v_update_type := 'official_confirmation';
      v_confidence  := 90;
      v_should_be_visible := true;
    ELSE
      v_update_type := 'generic_update';
      v_should_be_visible := true;
    END IF;
  END IF;

  -- Create event_source (ON CONFLICT DO NOTHING: deduplicate per feed per event)
  IF v_feed.id IS NOT NULL THEN
    INSERT INTO public.event_sources (
      event_id, normalized_source_item_id, source_feed_id,
      source_name, source_type, source_url,
      published_at, reliability_tier, stance
    ) VALUES (
      p_event_id, p_normalized_item_id, v_feed.id,
      v_feed.name, v_feed.source_type, v_raw.source_url,
      COALESCE(v_norm.occurred_at_estimate, v_raw.raw_published_at),
      COALESCE(v_feed.reliability_tier, 'medium'),
      'supports'
    )
    ON CONFLICT (event_id, source_feed_id) DO NOTHING;
  END IF;

  -- Create event_update (always, but visibility varies)
  INSERT INTO public.event_updates (
    event_id,
    normalized_source_item_id,
    content,
    source_name,
    source_url,
    update_type,
    headline,
    published_at,
    display_order_time,
    is_visible,
    confidence
  ) VALUES (
    p_event_id,
    p_normalized_item_id,
    COALESCE(v_norm.normalized_summary, v_norm.normalized_title),
    COALESCE(v_feed.name, v_raw.raw_author, 'Unknown source'),
    v_raw.source_url,
    v_update_type,
    CASE WHEN v_should_be_visible THEN v_norm.normalized_title ELSE NULL END,
    COALESCE(v_norm.occurred_at_estimate, v_raw.raw_published_at),
    COALESCE(v_norm.occurred_at_estimate, v_raw.raw_published_at, NOW()),
    v_should_be_visible,
    v_confidence
  );

  -- Mark normalized item matched
  UPDATE public.normalized_source_items
  SET matched_event_id = p_event_id,
      match_score      = p_match_score
  WHERE id = p_normalized_item_id;

  UPDATE public.raw_source_items
  SET fetch_status = 'matched'
  WHERE id = v_norm.raw_source_item_id;

  -- Recompute event scores and flags
  PERFORM public.recompute_event_state(p_event_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.attach_item_to_event(UUID, UUID, INTEGER, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.attach_item_to_event(UUID, UUID, INTEGER, UUID) TO service_role;
