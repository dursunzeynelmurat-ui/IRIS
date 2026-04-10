-- 012_ingest_event_validation.sql
--
-- Adds explicit input validation to ingest_event() (migration 011).
--
-- PROBLEMS (all silently allowed by the current implementation):
--
-- ── 1: Empty or whitespace-only title ────────────────────────────────────
--
--   ingest_event('', ...) or ingest_event('   ', ...) passes the duplicate
--   guard (no existing row with title = '' within 10 minutes) and commits a
--   garbage event row. The duplicate guard uses exact-match comparison, so
--   '  Flood  ' and 'Flood' are treated as distinct titles — leading/trailing
--   whitespace is silently preserved in the stored row.
--
--   FIX: RAISE EXCEPTION if trim(p_title) is empty. Trim the title before
--   both the duplicate check and the INSERT so stored titles are always clean.
--
-- ── 2: Empty updates array ───────────────────────────────────────────────
--
--   ingest_event('title', 'emerging', '[]') or ingest_event(..., NULL):
--   the FOR loop iterates zero times. The event row is committed with
--   source_count = 0 and no event_updates rows. Realtime never emits an
--   event_updates INSERT for this event. The timeline is permanently empty
--   and source_count will never increment unless a future service-role write
--   manually adds updates. The event is a sourceless stub.
--
--   FIX: RAISE EXCEPTION if p_updates is NULL or an empty array.
--   Require at least one update per ingested event.
--
-- ── 3: Update objects with missing required fields ────────────────────────
--
--   If an update object lacks "content" or "source_name", the INSERT into
--   event_updates fails with a NOT NULL constraint error. The transaction
--   rolls back correctly, but the error message is a raw Postgres constraint
--   string that gives no useful context to the caller about which field or
--   which update in the array is the problem.
--
--   FIX: validate each update object before iterating into INSERT statements.
--   RAISE EXCEPTION with a descriptive message that identifies the field.
--
-- ── 4: Invalid status ────────────────────────────────────────────────────
--
--   An invalid status (e.g. 'unknown') causes the events INSERT to fail with
--   a CHECK constraint error. The message is: "new row for relation "events"
--   violates check constraint "events_status_check"" — no indication of what
--   valid values are.
--
--   FIX: validate status before INSERT and raise a descriptive error listing
--   the valid values.
--
-- NOTE: whitespace trimming is applied to title only (a structural key).
--   content and source_name inside updates are validated for non-empty but
--   not trimmed — preserving the original source text is more important than
--   normalizing it server-side.

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
  v_title    TEXT;
  v_idx      INT := 0;
BEGIN
  -- ── Input validation ─────────────────────────────────────────────────

  -- Title: non-null, non-empty after trimming
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'ingest_event: p_title must be a non-empty string';
  END IF;
  v_title := trim(p_title);  -- canonical form: no leading/trailing whitespace

  -- Status: must be a recognised value (validates before the CHECK constraint
  -- fires so the error message is actionable)
  IF p_status NOT IN ('emerging', 'developing', 'verified', 'disputed') THEN
    RAISE EXCEPTION
      'ingest_event: invalid status "%". Valid values: emerging, developing, verified, disputed',
      p_status;
  END IF;

  -- Updates: must be a non-null, non-empty JSON array
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'ingest_event: p_updates must be a JSON array';
  END IF;
  IF jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'ingest_event: p_updates must contain at least one update';
  END IF;

  -- Validate each update object has non-empty required string fields
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
    RETURN NULL;  -- duplicate — caller should log and skip
  END IF;

  -- ── Atomic insert (event + all updates) ──────────────────────────────

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

-- Permissions unchanged from migration 011: internal function only.
REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) TO service_role;
