-- 027_feed_rpcs_and_ingest_update.sql
--
-- Three things in one migration:
--   A. get_feed_events() — unified backend-queryable feed RPC (New/Verified/Rising)
--   B. get_rising_events() — updated to return explicit card fields
--   C. ingest_event() — updated to accept all new fields from migrations 025/026
--
-- ── A: get_feed_events ────────────────────────────────────────────────────────
--
-- CONTEXT:
--   The IRIS feed has three explicit tabs the user can select:
--     New      → freshness-driven; all events ordered by most recent update
--     Verified → events with status='verified'; same freshness ordering
--     Rising   → momentum-driven; emerging/developing events ranked by activity
--
--   These modes must be backend-queryable — not just frontend filter logic — to
--   ensure consistent ordering semantics across clients and clean pagination.
--
-- FUNCTION: get_feed_events(p_mode, p_limit, p_offset)
--
--   p_mode    TEXT    DEFAULT 'new'  — 'new' | 'verified' | 'rising'
--   p_limit   INTEGER DEFAULT 20    — page size; clamped to 1–100
--   p_offset  INTEGER DEFAULT 0     — pagination offset; clamped to >= 0
--
--   Returns card-ready payload (NOT SETOF events — explicit columns for
--   stability against future schema additions to the events table):
--     id, title, image_url, summary, status, trust_score, source_count,
--     follow_count, latest_update_at, created_at
--
--   Mode semantics:
--     'new'      → all events; ORDER BY COALESCE(latest_update_at, created_at) DESC
--     'verified' → WHERE status = 'verified'; same ordering
--     'rising'   → WHERE status IN ('emerging', 'developing');
--                  ORDER BY rising_score DESC, then recency
--
--   Rising score formula (same as get_rising_events):
--     (follow_count * 10) + status_bonus + (trust_score / 10)
--     status_bonus: developing = 20, emerging = 10
--
-- SECURITY INVOKER: runs as the calling role; RLS on events applies.
-- Anon can read events (permissive SELECT from migration 001); this
-- function works for both anon and authenticated callers.
--
-- ── B: get_rising_events ──────────────────────────────────────────────────────
--
-- Updated to return explicit card-ready columns instead of SETOF public.events.
-- SETOF public.events would have continued to work (new columns would appear
-- automatically), but explicit column selection is more stable and self-documenting:
-- the frontend knows exactly what fields to expect.
--
-- The Rising score formula and filter (emerging/developing only) are unchanged.
--
-- ── C: ingest_event ───────────────────────────────────────────────────────────
--
-- Adds support for all new fields introduced in migrations 025 and 026:
--
--   Event-level (top-level parameters):
--     p_image_url TEXT DEFAULT NULL  — hero image URL for the event
--     p_summary   TEXT DEFAULT NULL  — 1-3 sentence contextual summary
--
--   Per-update (inside the p_updates JSONB array):
--     "update_type" — one of the 7 valid values (defaults to 'report' if absent)
--     "headline"    — optional short title for the update
--
-- The existing 3-argument call signature (title, status, updates) is superseded
-- by the 5-argument form. Since PostgreSQL does not allow CREATE OR REPLACE to
-- add parameters, the old function is DROPped first.
--
-- BACKWARD COMPAT:
--   Existing ingestion scripts that pass positional (title, status, updates)
--   continue to work because p_image_url and p_summary have DEFAULT NULL.
--   The per-update "update_type" and "headline" keys are also optional; if
--   absent, the DB defaults apply (update_type='report', headline=NULL).
--
-- PERMISSIONS: service_role only (same as before).


-- ── Part A: get_feed_events ───────────────────────────────────────────────────

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
  source_count     INTEGER,
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
      'get_feed_events: invalid mode "%". Valid values: new, verified, rising',
      p_mode;
  END IF;

  IF p_mode = 'rising' THEN
    RETURN QUERY
      SELECT
        e.id,
        e.title,
        e.image_url,
        e.summary,
        e.status,
        e.trust_score,
        e.source_count,
        e.follow_count,
        e.latest_update_at,
        e.created_at
      FROM public.events e
      WHERE e.status IN ('emerging', 'developing')
      ORDER BY
        -- Rising score: follow dominates; status and trust break ties
        (e.follow_count * 10)
          + CASE e.status WHEN 'developing' THEN 20 ELSE 10 END
          + (e.trust_score / 10)
        DESC,
        COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit
      OFFSET v_offset;

  ELSIF p_mode = 'verified' THEN
    RETURN QUERY
      SELECT
        e.id,
        e.title,
        e.image_url,
        e.summary,
        e.status,
        e.trust_score,
        e.source_count,
        e.follow_count,
        e.latest_update_at,
        e.created_at
      FROM public.events e
      WHERE e.status = 'verified'
      ORDER BY COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit
      OFFSET v_offset;

  ELSE
    -- 'new': all events, freshness-driven
    RETURN QUERY
      SELECT
        e.id,
        e.title,
        e.image_url,
        e.summary,
        e.status,
        e.trust_score,
        e.source_count,
        e.follow_count,
        e.latest_update_at,
        e.created_at
      FROM public.events e
      ORDER BY COALESCE(e.latest_update_at, e.created_at) DESC
      LIMIT v_limit
      OFFSET v_offset;
  END IF;
END;
$$;

-- Public read: same visibility as the events table.
-- No REVOKE needed — feed query is intentionally accessible to anon callers.


-- ── Part B: get_rising_events — explicit card columns ─────────────────────────

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
  source_count     INTEGER,
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
    e.id,
    e.title,
    e.image_url,
    e.summary,
    e.status,
    e.trust_score,
    e.source_count,
    e.follow_count,
    e.latest_update_at,
    e.created_at
  FROM public.events e
  WHERE e.status IN ('emerging', 'developing')
  ORDER BY
    (e.follow_count * 10)
      + CASE e.status WHEN 'developing' THEN 20 ELSE 10 END
      + (e.trust_score / 10)
    DESC,
    COALESCE(e.latest_update_at, e.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
$$;

-- No REVOKE: same public read visibility as before.


-- ── Part C: ingest_event — updated with card + update fields ──────────────────
--
-- Must DROP before recreate due to new parameters.
-- The REVOKE/GRANT are reapplied below.

DROP FUNCTION IF EXISTS public.ingest_event(TEXT, TEXT, JSONB);

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
  -- ── Input validation ──────────────────────────────────────────────────────

  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'ingest_event: p_title must be a non-empty string';
  END IF;
  v_title := trim(p_title);

  IF p_status NOT IN ('emerging', 'developing', 'verified', 'disputed') THEN
    RAISE EXCEPTION
      'ingest_event: invalid status "%". Valid values: emerging, developing, verified, disputed',
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
    -- Validate update_type if provided (DB CHECK covers this too, but an early
    -- exception gives a clearer error message than a constraint violation).
    IF v_update->>'update_type' IS NOT NULL
       AND v_update->>'update_type' NOT IN (
         'report', 'witness', 'official', 'confirmed',
         'under_verification', 'analysis', 'correction'
       )
    THEN
      RAISE EXCEPTION
        'ingest_event: update[%] has invalid update_type "%". Valid: report, witness, official, confirmed, under_verification, analysis, correction',
        v_idx, v_update->>'update_type';
    END IF;
  END LOOP;

  -- ── Concurrency + duplicate guard ─────────────────────────────────────────

  PERFORM pg_advisory_xact_lock(42, hashtext(v_title));

  SELECT id
  INTO v_event_id
  FROM public.events
  WHERE title = v_title
    AND created_at >= NOW() - INTERVAL '10 minutes'
  LIMIT 1;

  IF v_event_id IS NOT NULL THEN
    RETURN NULL;  -- duplicate within 10-minute window; caller treats NULL as skipped
  END IF;

  -- ── Atomic insert ─────────────────────────────────────────────────────────

  INSERT INTO public.events (title, status, image_url, summary)
  VALUES (v_title, p_status, p_image_url, p_summary)
  RETURNING id INTO v_event_id;

  v_idx := 0;
  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_idx := v_idx + 1;

    -- Resolve update_type: use provided value or fall back to column default.
    -- The COALESCE here matches the column DEFAULT 'report'.
    v_utype := COALESCE(v_update->>'update_type', 'report');

    INSERT INTO public.event_updates (
      event_id,
      content,
      source_name,
      source_url,
      source_id,
      update_type,
      headline
    )
    VALUES (
      v_event_id,
      trim(v_update->>'content'),
      trim(v_update->>'source_name'),
      v_update->>'source_url',
      -- source_id: optional UUID; NULL if key absent.
      (v_update->>'source_id')::UUID,
      v_utype,
      v_update->>'headline'   -- NULL if key absent
    );
  END LOOP;

  RETURN v_event_id;
END;
$$;

-- Reapply permissions (were on the now-dropped function).
REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;
