-- 024_source_trust_scoring.sql
--
-- Rewires the trust score pipeline so source reliability drives trust and
-- crowd signals provide only a minor capped adjustment.
--
-- TRUST FORMULA (authoritative):
--   trust_score = clamp(source_score + (crowd_score - 50) * 0.2, 0, 100)
--
--   crowd_score 50 → no effect (neutral baseline)
--   crowd_score 100 → +10 maximum boost
--   crowd_score   0 → -10 maximum penalty
--
-- SCORE PIPELINE:
--   crowd_score  = compute_crowd_score(confirms, disputes)
--   source_score = compute_source_score(event_id)   [AVG credibility of linked sources]
--   trust_score  = compute_trust_score(source_score, crowd_score)
--
-- SCORING FUNCTIONS:
--   compute_crowd_score(confirms, disputes)    IMMUTABLE  internal helper
--   compute_source_score(event_id)             STABLE     internal helper
--   compute_trust_score(source_score, crowd_score)  IMMUTABLE  internal helper
--   recalculate_event_scores(event_id)         VOLATILE   unified recompute entry point
--
-- BACKWARD COMPAT:
--   recalculate_trust_score(event_id) → shim → recalculate_event_scores(event_id)
--   reconcile_trust_scores()          → shim → reconcile_event_scores(), project trust cols
--
-- TRIGGER UPDATES:
--   trigger_sync_trust_score() now calls recalculate_event_scores (was recalculate_trust_score)
--   sync_source_count() extended to also call recalculate_event_scores after delta
--
-- ADMIN RECONCILIATION:
--   reconcile_event_scores() — repairs all three score columns in one pass
--   reconcile_trust_scores() — backward-compat shim (delegates to reconcile_event_scores)
--
-- INGEST UPDATE:
--   ingest_event() gains optional source_id per update in the JSONB array.
--   Existing callers without source_id continue to work unchanged.


-- ── Part 1: compute_crowd_score ───────────────────────────────────────────
--
-- Pure crowd formula. Replaces compute_trust_score(confirms, disputes) as the
-- crowd-only score helper. Same formula — confirm ratio 0–100, 50 on no signals.
-- IMMUTABLE: pure function, deterministic, no table access.

CREATE OR REPLACE FUNCTION public.compute_crowd_score(
  p_confirms INTEGER,
  p_disputes INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_confirms, 0) + COALESCE(p_disputes, 0) = 0
      THEN 50
    ELSE GREATEST(0, LEAST(100,
           ROUND(
             COALESCE(p_confirms, 0)::NUMERIC
             / (COALESCE(p_confirms, 0) + COALESCE(p_disputes, 0))
             * 100
           )::INTEGER
         ))
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_crowd_score(INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_crowd_score(INTEGER, INTEGER) TO service_role;


-- ── Part 2: compute_source_score ─────────────────────────────────────────
--
-- Queries the average credibility of structured sources linked to an event
-- via event_updates.source_id. Returns 50 (neutral) when no updates are
-- linked to a structured source record.
-- STABLE: reads tables, deterministic within a snapshot.

CREATE OR REPLACE FUNCTION public.compute_source_score(p_event_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN COUNT(s.id) = 0
      THEN 50    -- no linked sources → neutral
    ELSE GREATEST(0, LEAST(100, ROUND(AVG(s.credibility))::INTEGER))
  END
  FROM public.event_updates eu
  JOIN public.sources s ON s.id = eu.source_id
  WHERE eu.event_id = p_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_source_score(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_source_score(UUID) TO service_role;


-- ── Part 3: compute_trust_score (new semantics) ───────────────────────────
--
-- REPLACES the old compute_trust_score(confirms, disputes) formula.
-- Now takes (source_score, crowd_score) — the already-computed component scores.
-- Formula: clamp(source_score + (crowd_score - 50) * 0.2, 0, 100)
--
-- The signature (INTEGER, INTEGER) is unchanged, but the semantics are different.
-- All callers in this migration are updated to pass (source_score, crowd_score).
-- IMMUTABLE: pure function, no side effects.

CREATE OR REPLACE FUNCTION public.compute_trust_score(
  p_source_score INTEGER,
  p_crowd_score  INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0, LEAST(100,
    ROUND(p_source_score + (p_crowd_score - 50) * 0.2)::INTEGER
  ));
$$;

REVOKE EXECUTE ON FUNCTION public.compute_trust_score(INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_trust_score(INTEGER, INTEGER) TO service_role;


-- ── Part 4: recalculate_event_scores ─────────────────────────────────────
--
-- Unified entry point: acquires row lock on the event, computes all three
-- score columns (crowd_score, source_score, trust_score), writes them in a
-- single UPDATE.
--
-- Replaces recalculate_trust_score as the hot-path function called by triggers.
-- All score state is consistent after this call: no score can be from a
-- different snapshot than the others.
--
-- Safe if event is being deleted concurrently: FOR UPDATE finds no row, UPDATE
-- matches 0 rows, function returns normally.

CREATE OR REPLACE FUNCTION public.recalculate_event_scores(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confirms     INTEGER;
  v_disputes     INTEGER;
  v_crowd_score  INTEGER;
  v_source_score INTEGER;
BEGIN
  -- Serialize concurrent score recomputations for this event row.
  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;

  -- Count crowd signals
  SELECT
    COUNT(*) FILTER (WHERE type = 'confirm'),
    COUNT(*) FILTER (WHERE type = 'dispute')
  INTO v_confirms, v_disputes
  FROM public.signals
  WHERE event_id = p_event_id;

  v_crowd_score  := public.compute_crowd_score(v_confirms, v_disputes);
  v_source_score := public.compute_source_score(p_event_id);

  UPDATE public.events
  SET
    crowd_score  = v_crowd_score,
    source_score = v_source_score,
    trust_score  = public.compute_trust_score(v_source_score, v_crowd_score)
  WHERE id = p_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalculate_event_scores(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recalculate_event_scores(UUID) TO service_role;


-- ── Part 5: recalculate_trust_score — backward-compat shim ───────────────
--
-- Any existing code that calls recalculate_trust_score() continues to work.
-- It now recomputes all three scores, not just trust_score.

CREATE OR REPLACE FUNCTION public.recalculate_trust_score(p_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_event_scores(p_event_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recalculate_trust_score(UUID) TO service_role;


-- ── Part 6: trigger_sync_trust_score — call recalculate_event_scores ──────
--
-- Signals trigger: unchanged in purpose, updated to call the unified function.

CREATE OR REPLACE FUNCTION public.trigger_sync_trust_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_event_scores(OLD.event_id);
    RETURN OLD;
  END IF;
  PERFORM public.recalculate_event_scores(NEW.event_id);
  RETURN NEW;
END;
$$;

-- Trigger definition unchanged: AFTER INSERT OR UPDATE OR DELETE on signals
-- (defined in migration 013, recreated here to ensure consistency)
DROP TRIGGER IF EXISTS signals_sync_trust_score ON public.signals;

CREATE TRIGGER signals_sync_trust_score
  AFTER INSERT OR UPDATE OR DELETE ON public.signals
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_trust_score();


-- ── Part 7: sync_source_count — extend to recompute event scores ──────────
--
-- After updating source_count (INSERT or DELETE on event_updates), also
-- recompute all three score columns. This ensures source_score and trust_score
-- reflect any newly linked source_id at insert time.
--
-- The source_count delta UPDATE runs first; recalculate_event_scores then reads
-- the updated state (including the new/removed update row) to compute scores.

CREATE OR REPLACE FUNCTION public.sync_source_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events
    SET source_count = source_count + 1
    WHERE id = NEW.event_id;
    PERFORM public.recalculate_event_scores(NEW.event_id);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events
    SET source_count = GREATEST(source_count - 1, 0)
    WHERE id = OLD.event_id;
    PERFORM public.recalculate_event_scores(OLD.event_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Trigger definition unchanged (trg_sync_source_count created in migration 003)


-- ── Part 8: reconcile_event_scores ───────────────────────────────────────
--
-- Admin repair function: recomputes all three score columns for all events
-- in one pass, updating only rows where at least one score has drifted.
--
-- Returns one row per event that was updated, with old and new values for
-- all three scores.
--
-- WHEN TO CALL:
--   - After updating sources.credibility (a source's credibility change
--     affects source_score for all events that cite it; no live trigger
--     covers this to avoid expensive fan-out)
--   - After bulk data imports / TRUNCATE / trigger bypasses
--   - As a periodic health-check reconciliation job
--
-- NOTE: Does NOT acquire per-event FOR UPDATE locks. Intended for
-- maintenance windows or admin tooling. Do not run concurrently with
-- active signalling under high load.

CREATE OR REPLACE FUNCTION public.reconcile_event_scores()
RETURNS TABLE (
  event_id         UUID,
  old_source_score INTEGER,
  new_source_score INTEGER,
  old_crowd_score  INTEGER,
  new_crowd_score  INTEGER,
  old_trust_score  INTEGER,
  new_trust_score  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH signal_counts AS (
    SELECT
      s.event_id,
      COUNT(*) FILTER (WHERE s.type = 'confirm')::INTEGER AS confirms,
      COUNT(*) FILTER (WHERE s.type = 'dispute')::INTEGER AS disputes
    FROM public.signals s
    GROUP BY s.event_id
  ),
  source_avgs AS (
    SELECT
      eu.event_id,
      GREATEST(0, LEAST(100, ROUND(AVG(src.credibility))::INTEGER)) AS avg_credibility
    FROM public.event_updates eu
    JOIN public.sources src ON src.id = eu.source_id
    GROUP BY eu.event_id
  ),
  target AS (
    SELECT
      e.id                    AS event_id,
      e.source_score          AS old_source_score,
      e.crowd_score           AS old_crowd_score,
      e.trust_score           AS old_trust_score,
      COALESCE(sa.avg_credibility, 50) AS new_source_score,
      public.compute_crowd_score(
        COALESCE(sc.confirms, 0),
        COALESCE(sc.disputes, 0)
      )                       AS new_crowd_score
    FROM public.events e
    LEFT JOIN signal_counts sc ON sc.event_id = e.id
    LEFT JOIN source_avgs   sa ON sa.event_id = e.id
  ),
  changed AS (
    SELECT
      t.event_id,
      t.old_source_score,
      t.old_crowd_score,
      t.old_trust_score,
      t.new_source_score,
      t.new_crowd_score,
      public.compute_trust_score(t.new_source_score, t.new_crowd_score) AS new_trust_score
    FROM target t
    WHERE
      t.new_source_score <> t.old_source_score
      OR t.new_crowd_score  <> t.old_crowd_score
      OR public.compute_trust_score(t.new_source_score, t.new_crowd_score) <> t.old_trust_score
  )
  UPDATE public.events e
  SET
    source_score = c.new_source_score,
    crowd_score  = c.new_crowd_score,
    trust_score  = c.new_trust_score
  FROM changed c
  WHERE e.id = c.event_id
  RETURNING
    e.id,
    c.old_source_score, c.new_source_score,
    c.old_crowd_score,  c.new_crowd_score,
    c.old_trust_score,  c.new_trust_score;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_event_scores() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reconcile_event_scores() TO service_role;


-- ── Part 9: reconcile_trust_scores — backward-compat shim ────────────────
--
-- Existing callers that expect (event_id, old_score, new_score) continue to work.
-- Delegates to reconcile_event_scores and projects the trust_score columns.
-- Only returns rows where trust_score actually changed.

CREATE OR REPLACE FUNCTION public.reconcile_trust_scores()
RETURNS TABLE (event_id UUID, old_score INTEGER, new_score INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT r.event_id, r.old_trust_score, r.new_trust_score
  FROM public.reconcile_event_scores() r
  WHERE r.old_trust_score <> r.new_trust_score;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_trust_scores() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reconcile_trust_scores() TO service_role;


-- ── Part 10: ingest_event — support optional source_id per update ─────────
--
-- Each update object in p_updates may now include an optional "source_id" key
-- (UUID string). If present, the event_update row is linked to that source.
-- Existing callers without source_id in their update objects are unaffected.
--
-- No additional validation beyond the existing checks (migration 012):
-- an invalid UUID string will fail with a runtime cast error, which is
-- acceptable for a service-role-only function.

CREATE OR REPLACE FUNCTION public.ingest_event(
  p_title   TEXT,
  p_status  TEXT,
  p_updates JSONB
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
BEGIN
  -- ── Input validation (unchanged from migration 012) ──────────────────

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
  END LOOP;

  -- ── Concurrency + duplicate guard ────────────────────────────────────

  PERFORM pg_advisory_xact_lock(42, hashtext(v_title));

  SELECT id
  INTO v_event_id
  FROM public.events
  WHERE title = v_title
    AND created_at >= NOW() - INTERVAL '10 minutes'
  LIMIT 1;

  IF v_event_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- ── Atomic insert ────────────────────────────────────────────────────

  INSERT INTO public.events (title, status)
  VALUES (v_title, p_status)
  RETURNING id INTO v_event_id;

  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    INSERT INTO public.event_updates (event_id, content, source_name, source_url, source_id)
    VALUES (
      v_event_id,
      v_update->>'content',
      v_update->>'source_name',
      v_update->>'source_url',
      -- source_id: optional UUID; NULL if key absent. Invalid UUID string raises
      -- a runtime cast error (intentional — caller is service_role script).
      (v_update->>'source_id')::UUID
    );
  END LOOP;

  RETURN v_event_id;
END;
$$;

-- Permissions unchanged: internal function, service_role only.
REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) TO service_role;
