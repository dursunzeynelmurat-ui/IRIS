-- 035_security_fixes.sql
--
-- Security and correctness fixes identified by audit (2026-04-17).
--
-- CRITICAL:
--   1. create_event_for_item — TOCTOU: post-lock duplicate check used stale
--      in-memory row snapshot; re-read from DB after acquiring advisory lock.
--   2. recompute_event_state — tautological condition `ABS(x - x) > threshold`
--      was always false; trust score changes never recorded in score history.
--
-- HIGH:
--   3. toggle_event_follow — missing REVOKE EXECUTE FROM PUBLIC, allowing
--      anon callers to probe the endpoint. Restricted to `authenticated` only.
--   4. toggle_event_follow — unfollow TOCTOU: SELECT EXISTS → DELETE race;
--      rewritten to use DELETE … RETURNING for atomic correctness.
--
-- MEDIUM:
--   5. get_event_score_history — negative or extreme p_hours_back caused
--      confusing behaviour; input is now clamped to 1–8760 hours.
--   6. update_feed_health — atomic DB-side health score update function to
--      replace the non-atomic TypeScript read-compute-write pattern.
--
-- LOW / INFO:
--   7. search_events — was RETURNS SETOF public.events (forward-leaks all future
--      columns); now returns explicit EventCard-shaped column set.
--   8. search_event_updates — was RETURNS SETOF public.event_updates (exposes
--      internal pipeline columns); now returns explicit safe column set.


-- ── 1. Fix create_event_for_item — refresh snapshot after advisory lock ──────

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
  v_recheck_id  UUID;   -- fresh DB read after acquiring lock
BEGIN
  -- Load normalized item
  SELECT * INTO v_norm
  FROM public.normalized_source_items
  WHERE id = p_normalized_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_event_for_item: normalized item % not found', p_normalized_item_id;
  END IF;
  IF v_norm.matched_event_id IS NOT NULL THEN
    -- Already matched before we even try the lock; return existing.
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

  -- Concurrency guard: advisory lock on normalized title to prevent duplicate events.
  PERFORM pg_advisory_xact_lock(43, hashtext(lower(v_norm.normalized_title)));

  -- ── CRITICAL FIX: re-read from DB (not the in-memory snapshot) after lock ──
  -- A concurrent call that held the lock may have already created the event and
  -- updated matched_event_id between our initial load and lock acquisition.
  SELECT matched_event_id INTO v_recheck_id
  FROM public.normalized_source_items
  WHERE id = p_normalized_item_id;

  IF v_recheck_id IS NOT NULL THEN
    RETURN v_recheck_id;
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
      WHEN 'medium'   THEN 70
      ELSE                 60
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

  -- Trigger initial scoring
  PERFORM public.recompute_event_state(v_event_id);

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_event_for_item(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_event_for_item(UUID, UUID) TO service_role;


-- ── 2. Fix recompute_event_state — remove tautological trust_score condition ─
--
-- The old condition was:
--   ABS(v_new_importance - v_event.importance_score) > v_history_threshold
--   OR ABS(v_event.trust_score - v_event.trust_score) > v_history_threshold
--
-- The second clause is always `0 > 2` (false). Trust score snapshots are
-- managed by the trust_score trigger (not here) so the clause is removed.
-- Only importance_score changes trigger history recording in this function.

CREATE OR REPLACE FUNCTION public.recompute_event_state(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event            public.events%ROWTYPE;
  v_new_official     BOOLEAN  := false;
  v_new_conflict     BOOLEAN  := false;
  v_source_count     INTEGER  := 0;
  v_contradicts_count INTEGER := 0;
  v_new_status       TEXT;
  v_new_importance   INTEGER;
  v_new_feed_rank    NUMERIC(8,4);
  v_hours_since      DOUBLE PRECISION;
  v_history_threshold INTEGER := 2;
BEGIN
  -- Lock the event row to serialize concurrent recompute calls.
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- ── Step 1: Aggregate event_sources flags ──────────────────────────────

  SELECT
    COUNT(*)                                                       INTO v_source_count
  FROM public.event_sources
  WHERE event_id = p_event_id;

  SELECT
    COUNT(*) FILTER (WHERE reliability_tier = 'official')         INTO v_contradicts_count
  FROM public.event_sources
  WHERE event_id = p_event_id AND stance = 'contradicts';

  SELECT
    (COUNT(*) FILTER (WHERE reliability_tier = 'official') > 0)   INTO v_new_official
  FROM public.event_sources
  WHERE event_id = p_event_id AND stance = 'supports';

  SELECT
    (COUNT(*) > 0)                                                 INTO v_new_conflict
  FROM public.event_sources
  WHERE event_id = p_event_id AND stance = 'contradicts';

  -- ── Step 2: Derive new status ──────────────────────────────────────────

  v_new_status := v_event.status;

  IF v_new_conflict AND v_event.status NOT IN ('resolved', 'archived', 'contained') THEN
    v_new_status := 'conflicted';
  ELSIF v_new_official AND v_event.status IN ('new', 'conflicted') THEN
    v_new_status := 'verified';
  ELSIF v_source_count >= 3 AND v_event.status = 'new' THEN
    v_new_status := 'developing';
  END IF;

  -- ── Step 3: Compute importance_score ──────────────────────────────────

  v_new_importance := public.compute_importance_score(p_event_id);

  -- ── Step 4: Compute feed_rank ──────────────────────────────────────────

  v_hours_since := EXTRACT(EPOCH FROM (
    NOW() - COALESCE(v_event.last_updated_at, v_event.created_at)
  )) / 3600.0;

  v_new_feed_rank := public.compute_feed_rank(
    v_event.trust_score,
    v_new_importance,
    v_hours_since,
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

  -- ── Step 6: Record score history when importance changes meaningfully ───
  -- Trust score history is appended by the trust_score trigger, not here.

  IF ABS(v_new_importance - v_event.importance_score) > v_history_threshold THEN
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


-- ── 3+4. Fix toggle_event_follow — REVOKE + atomic unfollow ─────────────────
--
-- Before this migration, toggle_event_follow had no REVOKE FROM PUBLIC, making
-- it callable by anon (which raised 'Not authenticated' but still probed the
-- endpoint). Now restricted to `authenticated` only.
--
-- Also fixes the SELECT EXISTS → DELETE race on unfollow. The new version uses
-- DELETE … RETURNING to detect whether the row was actually deleted, making the
-- operation atomic and ensuring the correct result string is returned.

CREATE OR REPLACE FUNCTION public.toggle_event_follow(p_event_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_deleted_id    UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Attempt unfollow first (atomic: returns the deleted row's user_id or nothing).
  DELETE FROM public.event_follows
  WHERE user_id = v_user_id AND event_id = p_event_id
  RETURNING user_id INTO v_deleted_id;

  IF v_deleted_id IS NOT NULL THEN
    RETURN 'unfollowed';
  END IF;

  -- Row was not present: follow.
  INSERT INTO public.event_follows (user_id, event_id)
  VALUES (v_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  RETURN 'followed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.toggle_event_follow(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.toggle_event_follow(UUID) TO authenticated;


-- ── 5. Fix get_event_score_history — clamp p_hours_back ─────────────────────

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
    AND h.recorded_at >= NOW() - (
          GREATEST(1, LEAST(COALESCE(p_hours_back, 24), 8760)) || ' hours'
        )::INTERVAL
  ORDER BY h.recorded_at ASC
  LIMIT 48;
$$;


-- ── 6. update_feed_health — atomic DB-side health score function ─────────────
--
-- Replaces the TypeScript read-then-write pattern with a single SQL UPDATE that
-- uses LEAST/GREATEST for clamping. The TypeScript worker calls this RPC.

CREATE OR REPLACE FUNCTION public.update_feed_health(
  p_feed_id      UUID,
  p_success      BOOLEAN,
  p_error_message TEXT DEFAULT NULL,
  p_now          TIMESTAMPTZ DEFAULT NOW()
)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.source_feeds
  SET
    last_fetched_at    = p_now,
    last_success_at    = CASE WHEN p_success THEN p_now ELSE last_success_at END,
    last_error_at      = CASE WHEN p_success THEN last_error_at ELSE p_now END,
    last_error_message = CASE WHEN p_success THEN NULL ELSE p_error_message END,
    health_score       = CASE
                           WHEN p_success
                             THEN LEAST(100,  health_score + 10)
                           ELSE   GREATEST(0, health_score - 20)
                         END
  WHERE id = p_feed_id;
$$;

REVOKE EXECUTE ON FUNCTION public.update_feed_health(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_feed_health(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) TO service_role;


-- ── 7. Fix search_events — explicit columns (no SETOF public.events) ─────────
--
-- Old: RETURNS SETOF public.events — automatically exposed all future columns.
-- New: Returns the EventCard-compatible column set explicitly.

DROP FUNCTION IF EXISTS public.search_events(TEXT, INTEGER);

CREATE FUNCTION public.search_events(
  p_query TEXT,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id               UUID,
  title            TEXT,
  image_url        TEXT,
  summary          TEXT,
  status           TEXT,
  trust_score      INTEGER,
  importance_score INTEGER,
  feed_rank        NUMERIC(8,4),
  source_count     INTEGER,
  follow_count     INTEGER,
  update_count     INTEGER,
  official_confirmation BOOLEAN,
  conflict_flag    BOOLEAN,
  latest_update_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pattern TEXT;
BEGIN
  IF length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION 'search query must be at least 2 characters';
  END IF;

  v_pattern := '%' || lower(trim(p_query)) || '%';

  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.image_url,
    e.summary,
    e.status,
    e.trust_score,
    e.importance_score,
    e.feed_rank,
    e.source_count,
    e.follow_count,
    e.update_count,
    e.official_confirmation,
    e.conflict_flag,
    e.latest_update_at,
    e.created_at
  FROM public.events e
  WHERE
    e.visibility = 'visible'
    AND (
      lower(e.title) LIKE v_pattern
      OR EXISTS (
        SELECT 1
        FROM public.event_updates u
        WHERE u.event_id = e.id
          AND u.is_visible = true
          AND (
            lower(u.content)     LIKE v_pattern
            OR lower(u.source_name) LIKE v_pattern
          )
      )
    )
  ORDER BY
    CASE WHEN lower(e.title) LIKE v_pattern THEN 0 ELSE 1 END,
    e.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;

-- No REVOKE: public read like events table.


-- ── 8. Fix search_event_updates — explicit columns ───────────────────────────
--
-- Old: RETURNS SETOF public.event_updates — exposed internal pipeline columns
--      (normalized_source_item_id, impact_delta_trust, impact_delta_importance,
--       is_visible, confidence).
-- New: Returns only the safe columns the UI actually needs.

DROP FUNCTION IF EXISTS public.search_event_updates(TEXT);

CREATE FUNCTION public.search_event_updates(p_query TEXT)
RETURNS TABLE (
  id          UUID,
  event_id    UUID,
  update_type TEXT,
  headline    TEXT,
  content     TEXT,
  source_name TEXT,
  source_url  TEXT,
  published_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
  SELECT
    eu.id,
    eu.event_id,
    eu.update_type,
    eu.headline,
    eu.content,
    eu.source_name,
    eu.source_url,
    eu.published_at,
    eu.created_at
  FROM public.event_updates eu
  WHERE
    eu.is_visible = true
    AND p_query IS NOT NULL
    AND p_query <> ''
    AND websearch_to_tsquery('english', p_query) IS NOT NULL
    AND to_tsvector('english',
          coalesce(eu.content, '') || ' ' || coalesce(eu.source_name, '')
        )
        @@ websearch_to_tsquery('english', p_query)
  ORDER BY
    ts_rank(
      to_tsvector('english',
        coalesce(eu.content, '') || ' ' || coalesce(eu.source_name, '')
      ),
      websearch_to_tsquery('english', p_query)
    ) DESC,
    eu.created_at DESC
  LIMIT 50;
$$;

-- No REVOKE: SECURITY INVOKER — RLS on event_updates applies.
