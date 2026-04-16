-- 033_scoring_and_ranking.sql
--
-- Implements the Phase 2 scoring and ranking system:
--
-- FUNCTIONS:
--   compute_importance_score(event_id)       — Rule-based importance (0–100)
--   compute_feed_rank(...)                   — Weighted composite feed rank
--   recompute_event_state(event_id)          — Unified recompute + history append
--   trigger_recompute_on_source_change()     — Trigger for event_sources changes
--   trigger_sync_primary_image()             — Propagate primary media to image_url
--
-- STATUS CHECK TIGHTENED:
--   Removes old status values ('emerging', 'disputed') now that data migration
--   in migration 030 has converted all rows.
--
-- INGEST_EVENT UPDATED:
--   Accepts new status vocabulary. Old values ('emerging', 'disputed') now
--   rejected with a descriptive error pointing to replacements.
--
-- GET_FEED_EVENTS UPDATED:
--   Rising mode: uses 'new' instead of 'emerging'
--   All modes: filter out non-visible events (visibility = 'visible')
--   Adds importance_score to returned payload
--   Default ordering uses feed_rank DESC as primary sort (except 'new' mode)
--
-- GET_RISING_EVENTS UPDATED:
--   Same changes as get_feed_events rising mode.


-- ── Part 1: Tighten status CHECK ──────────────────────────────────────────

ALTER TABLE public.events
  DROP CONSTRAINT events_status_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_status_check
  CHECK (status IN ('new', 'developing', 'verified', 'conflicted', 'contained', 'resolved', 'archived'));


-- ── Part 2: compute_importance_score ─────────────────────────────────────
--
-- Importance = "does this matter operationally?" (0–100).
-- Separate from trust_score ("is this true?").
--
-- Rules:
--   Base: 50 (neutral — unknown importance)
--   +20 if official_confirmation = true
--   +10 if trust_score >= 70 AND source_count >= 3 (multi-source, credible)
--   +10 if update_count >= 5 (significant developments)
--   +5  if conflict_flag = true (conflicted events are noteworthy)
--   -15 if status IN ('contained', 'resolved', 'archived') (resolved = less urgent)
--   -10 if source_count <= 1 AND trust_score < 50 (single weak source)
--   Clamp 0–100

CREATE OR REPLACE FUNCTION public.compute_importance_score(p_event_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score   INTEGER := 50;
  v_event   public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN 50;
  END IF;

  -- Official confirmation is the strongest signal
  IF v_event.official_confirmation THEN
    v_score := v_score + 20;
  END IF;

  -- Multi-source credible coverage
  IF v_event.trust_score >= 70 AND v_event.source_count >= 3 THEN
    v_score := v_score + 10;
  END IF;

  -- Significant volume of developments
  IF v_event.update_count >= 5 THEN
    v_score := v_score + 10;
  END IF;

  -- Conflicted events are inherently noteworthy
  IF v_event.conflict_flag THEN
    v_score := v_score + 5;
  END IF;

  -- Resolved/contained events are lower urgency
  IF v_event.status IN ('contained', 'resolved', 'archived') THEN
    v_score := v_score - 15;
  END IF;

  -- Single weak source: low importance
  IF v_event.source_count <= 1 AND v_event.trust_score < 50 THEN
    v_score := v_score - 10;
  END IF;

  RETURN GREATEST(0, LEAST(100, v_score));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_importance_score(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_importance_score(UUID) TO service_role;


-- ── Part 3: compute_feed_rank ──────────────────────────────────────────────
--
-- Weighted composite rank for feed ordering. IMMUTABLE — pure computation.
--
-- Formula:
--   rank = (trust * 0.25) + (importance * 0.25) + (recency * 0.20)
--        + (engagement * 0.10) + (coverage * 0.10) + (boost_penalties * 0.10)
--
-- recency_score: 100 * pow(0.5, hours_since_update / 12) — halves every 12h
-- engagement_score: LEAST(100, follow_count * 5)
-- coverage_score: LEAST(100, source_count * 8 + update_count * 4)
-- official_boost: +10 if official_confirmation
-- conflict_penalty: -5 if conflict_flag
--
-- Clamp final result 0–100.

CREATE OR REPLACE FUNCTION public.compute_feed_rank(
  p_trust_score         INTEGER,
  p_importance_score    INTEGER,
  p_hours_since_update  NUMERIC,
  p_follow_count        INTEGER,
  p_source_count        INTEGER,
  p_update_count        INTEGER,
  p_official            BOOLEAN,
  p_conflict            BOOLEAN
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0, LEAST(100,
    -- Core scores (trust + importance carry 50% of weight)
    COALESCE(p_trust_score, 50)      * 0.25
    + COALESCE(p_importance_score, 50) * 0.25
    -- Recency: halves every 12 hours; 0h = 100, 12h = 50, 24h = 25, 48h = 6.25
    + 100.0 * POWER(0.5::NUMERIC, GREATEST(0, COALESCE(p_hours_since_update, 0)) / 12.0) * 0.20
    -- Engagement: follow count, capped at effective 20 contribution
    + LEAST(100, COALESCE(p_follow_count, 0) * 5) * 0.10
    -- Coverage richness: sources + update volume
    + LEAST(100, COALESCE(p_source_count, 0) * 8 + COALESCE(p_update_count, 0) * 4) * 0.10
    -- Binary boost/penalty
    + CASE WHEN COALESCE(p_official, false)  THEN 10 ELSE 0 END
    - CASE WHEN COALESCE(p_conflict, false)  THEN  5 ELSE 0 END
  ));
$$;

REVOKE EXECUTE ON FUNCTION public.compute_feed_rank(INTEGER,INTEGER,NUMERIC,INTEGER,INTEGER,INTEGER,BOOLEAN,BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_feed_rank(INTEGER,INTEGER,NUMERIC,INTEGER,INTEGER,INTEGER,BOOLEAN,BOOLEAN) TO service_role;


-- ── Part 4: recompute_event_state ─────────────────────────────────────────
--
-- Comprehensive event state recomputation. Call after any event change:
--   - new event_source added
--   - new event_update created
--   - trust_score changed (existing trigger handles this separately)
--
-- Steps:
--   1. Recompute official_confirmation and conflict_flag from event_sources
--   2. Recompute status (may upgrade to 'verified' or flag as 'conflicted')
--   3. Recompute importance_score
--   4. Recompute feed_rank
--   5. Update last_updated_at
--   6. Append to event_score_history (if scores changed by > 2 points)
--
-- Status auto-advancement rules (conservative V1 rules):
--   new → developing: when source_count >= 2
--   developing → verified: when official_confirmation = true AND trust_score >= 70
--   * → conflicted: when conflict_flag = true (can override other states)
--   'conflicted' reverts to previous status when conflict_flag is cleared

CREATE OR REPLACE FUNCTION public.recompute_event_state(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event              public.events%ROWTYPE;
  v_new_official       BOOLEAN;
  v_new_conflict       BOOLEAN;
  v_new_status         TEXT;
  v_new_importance     INTEGER;
  v_new_feed_rank      NUMERIC;
  v_hours_since_update NUMERIC;
  v_history_threshold  INTEGER := 2; -- only record history if score changes > 2 pts
BEGIN
  -- Lock the event row to prevent concurrent recomputation races
  SELECT * INTO v_event
  FROM public.events WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- ── Step 1: Recompute flags from event_sources ──────────────────────────

  -- official_confirmation: at least one official source supports the event
  SELECT EXISTS (
    SELECT 1 FROM public.event_sources
    WHERE event_id = p_event_id
      AND reliability_tier = 'official'
      AND stance <> 'contradicts'
  ) INTO v_new_official;

  -- Also check event_updates for official_confirmation type
  SELECT v_new_official OR EXISTS (
    SELECT 1 FROM public.event_updates
    WHERE event_id = p_event_id
      AND update_type IN ('official_confirmation', 'official', 'confirmed')
      AND is_visible = true
  ) INTO v_new_official;

  -- conflict_flag: at least one source actively contradicts
  SELECT EXISTS (
    SELECT 1 FROM public.event_sources
    WHERE event_id = p_event_id
      AND stance = 'contradicts'
  ) INTO v_new_conflict;

  -- ── Step 2: Status auto-advancement ────────────────────────────────────
  v_new_status := v_event.status;

  -- Don't auto-advance terminal states
  IF v_event.status NOT IN ('contained', 'resolved', 'archived') THEN

    IF v_new_conflict AND v_event.status NOT IN ('conflicted', 'verified') THEN
      -- Conflicting source → mark as conflicted (except verified: verified events
      -- can have contradictions without losing their status)
      v_new_status := 'conflicted';

    ELSIF v_new_official AND v_event.trust_score >= 70 AND v_event.source_count >= 2 THEN
      -- Official confirmation + high trust + multi-source → verified
      v_new_status := 'verified';

    ELSIF v_event.status = 'new' AND v_event.source_count >= 2 THEN
      -- Multiple sources reporting → developing
      v_new_status := 'developing';

    END IF;
  END IF;

  -- ── Step 3: Importance score ────────────────────────────────────────────

  -- Temporarily update flags so compute_importance_score reads fresh values
  UPDATE public.events
  SET official_confirmation = v_new_official,
      conflict_flag         = v_new_conflict,
      status                = v_new_status
  WHERE id = p_event_id;

  v_new_importance := public.compute_importance_score(p_event_id);

  -- ── Step 4: Feed rank ───────────────────────────────────────────────────

  v_hours_since_update := EXTRACT(EPOCH FROM (
    NOW() - COALESCE(v_event.latest_update_at, v_event.created_at)
  )) / 3600.0;

  v_new_feed_rank := public.compute_feed_rank(
    v_event.trust_score,
    v_new_importance,
    v_hours_since_update,
    v_event.follow_count,
    v_event.source_count,
    v_event.update_count,
    v_new_official,
    v_new_conflict
  );

  -- ── Step 5: Write all recomputed values ────────────────────────────────

  UPDATE public.events
  SET
    official_confirmation = v_new_official,
    conflict_flag         = v_new_conflict,
    status                = v_new_status,
    importance_score      = v_new_importance,
    feed_rank             = v_new_feed_rank,
    last_updated_at       = NOW()
  WHERE id = p_event_id;

  -- ── Step 6: Record score history if changed meaningfully ───────────────

  IF ABS(v_new_importance - v_event.importance_score) > v_history_threshold
     OR ABS(v_event.trust_score - v_event.trust_score) > v_history_threshold
  THEN
    INSERT INTO public.event_score_history (
      event_id, trust_score, importance_score, status_snapshot
    ) VALUES (
      p_event_id, v_event.trust_score, v_new_importance, v_new_status
    );
  END IF;

END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_event_state(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_event_state(UUID) TO service_role;


-- ── Part 5: trigger_recompute_on_source_change ────────────────────────────
--
-- Fires when an event_source is inserted or deleted.
-- Triggers recompute_event_state to refresh flags, status, importance, rank.

CREATE OR REPLACE FUNCTION public.trigger_recompute_on_source_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_event_state(OLD.event_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_event_state(NEW.event_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_on_source_change ON public.event_sources;

CREATE TRIGGER trg_recompute_on_source_change
  AFTER INSERT OR DELETE ON public.event_sources
  FOR EACH ROW EXECUTE FUNCTION public.trigger_recompute_on_source_change();


-- ── Part 6: trigger_sync_primary_image ────────────────────────────────────
--
-- When an event_media row with is_primary=true is inserted or updated,
-- propagate its image_url to events.image_url.

CREATE OR REPLACE FUNCTION public.sync_primary_image()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary = true AND NEW.image_url IS NOT NULL THEN
    UPDATE public.events
    SET image_url = NEW.image_url
    WHERE id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_primary_image ON public.event_media;

CREATE TRIGGER trg_sync_primary_image
  AFTER INSERT OR UPDATE OF is_primary, image_url ON public.event_media
  FOR EACH ROW EXECUTE FUNCTION public.sync_primary_image();


-- ── Part 7: Update ingest_event for new status vocabulary ─────────────────
--
-- The current ingest_event (migration 027) validates against old status values.
-- Update validation to accept new values; reject old ones with guidance.
-- Drop and recreate (PostgreSQL does not allow CREATE OR REPLACE with param changes).

DROP FUNCTION IF EXISTS public.ingest_event(TEXT, TEXT, JSONB, TEXT, TEXT);

CREATE FUNCTION public.ingest_event(
  p_title     TEXT,
  p_status    TEXT,
  p_updates   JSONB,
  p_image_url TEXT    DEFAULT NULL,
  p_summary   TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_update   JSONB;
  v_title    TEXT;
  v_idx      INT := 0;
  v_utype    TEXT;
BEGIN
  -- ── Input validation ──────────────────────────────────────────────────

  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'ingest_event: p_title must be a non-empty string';
  END IF;
  v_title := trim(p_title);

  -- Reject old status values with guidance
  IF p_status IN ('emerging', 'disputed') THEN
    RAISE EXCEPTION
      'ingest_event: status "%" is no longer valid. Use "new" instead of "emerging", "conflicted" instead of "disputed".',
      p_status;
  END IF;

  IF p_status NOT IN ('new', 'developing', 'verified', 'conflicted', 'contained', 'resolved', 'archived') THEN
    RAISE EXCEPTION
      'ingest_event: invalid status "%". Valid values: new, developing, verified, conflicted, contained, resolved, archived',
      p_status;
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'ingest_event: p_updates must be a JSON array';
  END IF;
  IF jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'ingest_event: p_updates must contain at least one update';
  END IF;

  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_idx := v_idx + 1;
    IF v_update->>'content' IS NULL OR length(trim(v_update->>'content')) = 0 THEN
      RAISE EXCEPTION
        'ingest_event: update[%] is missing a non-empty "content" field', v_idx;
    END IF;
    IF v_update->>'source_name' IS NULL OR length(trim(v_update->>'source_name')) = 0 THEN
      RAISE EXCEPTION
        'ingest_event: update[%] is missing a non-empty "source_name" field', v_idx;
    END IF;
    IF v_update->>'update_type' IS NOT NULL
       AND v_update->>'update_type' NOT IN (
         'report', 'witness', 'official', 'confirmed', 'under_verification',
         'analysis', 'correction', 'first_report', 'official_confirmation',
         'casualty_update', 'location_refinement', 'escalation', 'deescalation',
         'denial', 'contradiction', 'closure', 'generic_update'
       )
    THEN
      RAISE EXCEPTION
        'ingest_event: update[%] has invalid update_type "%"', v_idx, v_update->>'update_type';
    END IF;
  END LOOP;

  -- ── Concurrency + duplicate guard ────────────────────────────────────

  PERFORM pg_advisory_xact_lock(42, hashtext(v_title));

  SELECT id INTO v_event_id
  FROM public.events
  WHERE lower(title) = lower(v_title)
    AND created_at >= NOW() - INTERVAL '10 minutes'
  LIMIT 1;

  IF v_event_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ── Atomic insert ─────────────────────────────────────────────────────

  INSERT INTO public.events (
    title, status, image_url, summary,
    first_seen_at, last_updated_at,
    slug
  )
  VALUES (
    v_title, p_status, p_image_url, p_summary,
    NOW(), NOW(),
    lower(regexp_replace(trim(v_title), '[^a-zA-Z0-9]+', '-', 'g'))
    || '-' || substr(gen_random_uuid()::text, 1, 8)
  )
  RETURNING id INTO v_event_id;

  v_idx := 0;
  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_idx := v_idx + 1;
    v_utype := COALESCE(v_update->>'update_type', 'report');

    INSERT INTO public.event_updates (
      event_id, content, source_name, source_url, source_id,
      update_type, headline,
      is_visible
    )
    VALUES (
      v_event_id,
      trim(v_update->>'content'),
      trim(v_update->>'source_name'),
      v_update->>'source_url',
      (v_update->>'source_id')::UUID,
      v_utype,
      v_update->>'headline',
      true
    );
  END LOOP;

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;


-- ── Part 8: Update get_feed_events ────────────────────────────────────────
--
-- Changes:
--   'rising' mode: 'new' replaces 'emerging' in status filter
--   All modes: exclude non-visible events (visibility != 'visible')
--   Response payload: + importance_score, + feed_rank
--   New default ordering for 'verified' and 'new': feed_rank DESC first,
--     then recency as tiebreaker (feed_rank already encodes recency decay)

CREATE OR REPLACE FUNCTION public.get_feed_events(
  p_mode   TEXT    DEFAULT 'new',
  p_limit  INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  image_url        TEXT,
  summary          TEXT,
  status           TEXT,
  trust_score      INTEGER,
  importance_score INTEGER,
  feed_rank        NUMERIC,
  source_count     INTEGER,
  update_count     INTEGER,
  follow_count     INTEGER,
  latest_update_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit  INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
  v_offset INTEGER := GREATEST(0, COALESCE(p_offset, 0));
BEGIN
  IF p_mode NOT IN ('new', 'verified', 'rising') THEN
    RAISE EXCEPTION
      'get_feed_events: invalid mode "%". Valid values: new, verified, rising', p_mode;
  END IF;

  IF p_mode = 'rising' THEN
    RETURN QUERY
      SELECT e.id, e.title, e.image_url, e.summary, e.status,
             e.trust_score, e.importance_score, e.feed_rank,
             e.source_count, e.update_count, e.follow_count,
             e.latest_update_at, e.created_at
      FROM public.events e
      WHERE e.status IN ('new', 'developing')
        AND e.visibility = 'visible'
      ORDER BY e.feed_rank DESC, COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit OFFSET v_offset;

  ELSIF p_mode = 'verified' THEN
    RETURN QUERY
      SELECT e.id, e.title, e.image_url, e.summary, e.status,
             e.trust_score, e.importance_score, e.feed_rank,
             e.source_count, e.update_count, e.follow_count,
             e.latest_update_at, e.created_at
      FROM public.events e
      WHERE e.status = 'verified'
        AND e.visibility = 'visible'
      ORDER BY e.feed_rank DESC, COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit OFFSET v_offset;

  ELSE
    -- 'new': all visible events, freshness-first
    RETURN QUERY
      SELECT e.id, e.title, e.image_url, e.summary, e.status,
             e.trust_score, e.importance_score, e.feed_rank,
             e.source_count, e.update_count, e.follow_count,
             e.latest_update_at, e.created_at
      FROM public.events e
      WHERE e.visibility = 'visible'
      ORDER BY COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit OFFSET v_offset;
  END IF;
END;
$$;


-- ── Part 9: Update get_rising_events ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_rising_events(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  image_url        TEXT,
  summary          TEXT,
  status           TEXT,
  trust_score      INTEGER,
  importance_score INTEGER,
  feed_rank        NUMERIC,
  source_count     INTEGER,
  update_count     INTEGER,
  follow_count     INTEGER,
  latest_update_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    e.id, e.title, e.image_url, e.summary, e.status,
    e.trust_score, e.importance_score, e.feed_rank,
    e.source_count, e.update_count, e.follow_count,
    e.latest_update_at, e.created_at
  FROM public.events e
  WHERE e.status IN ('new', 'developing')
    AND e.visibility = 'visible'
  ORDER BY e.feed_rank DESC, COALESCE(e.latest_update_at, e.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;


-- ── Part 10: Bulk recompute feed rank for all visible events ───────────────
--
-- Run once after applying this migration to seed feed_rank values.
-- Also useful as a periodic maintenance job.

DO $$
DECLARE
  v_event_id UUID;
BEGIN
  FOR v_event_id IN
    SELECT id FROM public.events WHERE visibility = 'visible'
  LOOP
    PERFORM public.recompute_event_state(v_event_id);
  END LOOP;
END;
$$;
