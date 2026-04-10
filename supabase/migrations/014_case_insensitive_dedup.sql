-- 014_case_insensitive_dedup.sql
--
-- Two related dedup correctness/performance issues in ingest_event():
--
-- ── Issue 1: Case-sensitive duplicate detection ───────────────────────────
--
-- PROBLEM:
--   The duplicate guard uses `WHERE title = v_title` (exact case-sensitive
--   match after whitespace trimming). This means:
--     "Flood in Region X"      → stored
--     "flood in region x"      → stored again (different event)
--     "FLOOD IN REGION X"      → stored again (another duplicate)
--
--   The advisory lock is keyed on hashtext(v_title), which is also
--   case-sensitive. Two concurrent calls with different casing do not
--   serialize at the lock and can both pass the duplicate check and insert.
--
--   For an ingest pipeline that may receive events from different sources
--   with inconsistent casing, this produces silent duplicates.
--
-- FIX:
--   1. Change the advisory lock key to hashtext(lower(v_title)) so
--      concurrent calls with any casing serialize on the same lock.
--   2. Change the dedup query to `WHERE lower(title) = lower(v_title)`
--      for case-insensitive comparison.
--
--   Storage is unchanged: titles are stored with original case (trimmed
--   whitespace, casing preserved). Dedup normalization affects only the
--   comparison, not the stored value.
--
-- ── Issue 2: No index for dedup query ────────────────────────────────────
--
-- PROBLEM:
--   The dedup query scans the events table filtered by title equality and
--   created_at range. With no index supporting this query, each ingest call
--   is an O(n) sequential scan. Low impact with 15 seed events; grows with
--   the event table.
--
--   After fixing to case-insensitive comparison, the WHERE clause becomes
--   `WHERE lower(title) = lower(v_title) AND created_at >= ...`.
--   The existing idx_events_created_at index (on created_at DESC) could
--   partially help but the title filter is the more selective condition.
--
-- FIX:
--   Create a functional index on (lower(title), created_at DESC).
--   The query planner can use this index to:
--     1. Seek directly to rows with the normalised title value (equality)
--     2. Apply the created_at range filter on the restricted set
--   This is O(log n) for the title lookup regardless of table size.

-- ── Part 1: Functional index for dedup query ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_events_dedup
  ON public.events (lower(title), created_at DESC);

-- ── Part 2: Recreate ingest_event with case-insensitive dedup ────────────

CREATE OR REPLACE FUNCTION public.ingest_event(
  p_title   TEXT,
  p_status  TEXT,
  p_updates JSONB   -- array of {content, source_name, source_url?} objects
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
  v_update   JSONB;
  v_title    TEXT;   -- trimmed original-case title (stored form)
  v_idx      INT := 0;
BEGIN
  -- ── Input validation (unchanged from migration 012) ───────────────────

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

  -- ── Concurrency + duplicate guard (case-insensitive) ─────────────────

  -- Advisory lock keyed on the lower-cased title so concurrent calls with
  -- any casing ("Flood" / "flood" / "FLOOD") serialize on the same lock.
  PERFORM pg_advisory_xact_lock(42, hashtext(lower(v_title)));

  -- Duplicate check: case-insensitive title match within last 10 minutes.
  -- Stored titles preserve original case; comparison normalises both sides.
  SELECT id
  INTO v_event_id
  FROM public.events
  WHERE lower(title) = lower(v_title)
    AND created_at >= NOW() - INTERVAL '10 minutes'
  LIMIT 1;

  IF v_event_id IS NOT NULL THEN
    RETURN NULL;  -- duplicate — caller should log and skip
  END IF;

  -- ── Atomic insert (event + all updates) ──────────────────────────────

  -- Store title with original case (trimmed whitespace).
  INSERT INTO public.events (title, status)
  VALUES (v_title, p_status)
  RETURNING id INTO v_event_id;

  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    INSERT INTO public.event_updates (event_id, content, source_name, source_url)
    VALUES (
      v_event_id,
      v_update->>'content',
      v_update->>'source_name',
      v_update->>'source_url'   -- NULL when key is absent
    );
  END LOOP;

  RETURN v_event_id;
END;
$$;

-- Permissions unchanged.
REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) TO service_role;
