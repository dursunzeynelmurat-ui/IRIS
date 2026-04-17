-- 019_event_update_fields.sql
--
-- Adds two new optional columns to event_updates and to the events table,
-- then updates ingest_event() to populate them when present in the payload.
--
-- ── event_updates.headline ────────────────────────────────────────────────
--
--   A short, editor-written summary line for the update. When present, the
--   client displays it as the primary text (bold, larger) with the full
--   content below it. Allows the ingest script to supply a concise
--   "what happened" line separate from the full source text.
--
-- ── event_updates.update_type ────────────────────────────────────────────
--
--   A controlled vocabulary tag that classifies the nature of the update.
--   Valid values (or NULL for unclassified):
--     'development' — new factual development (default when classified)
--     'breaking'    — high-urgency, time-sensitive update
--     'context'     — background or explanatory information
--     'correction'  — correction to previously reported information
--
--   The client uses this for restrained visual treatment (dot color only);
--   it does NOT drive any prominent UI affordance.
--
-- ── events.summary ────────────────────────────────────────────────────────
--
--   A short (1-3 sentence) plain-text description of the event, editor or
--   ingest-script provided. Shown as a secondary line on feed cards and
--   under the title on the detail screen.

-- ── Column additions ──────────────────────────────────────────────────────

ALTER TABLE public.event_updates
  ADD COLUMN IF NOT EXISTS headline     TEXT,
  ADD COLUMN IF NOT EXISTS update_type  TEXT
    CHECK (update_type IN ('development', 'breaking', 'context', 'correction'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS summary TEXT;

-- ── Updated ingest_event() ────────────────────────────────────────────────
--
-- Signature is additive (new DEFAULT NULL params) — existing callers that
-- pass (p_title, p_status, p_updates) continue to work without modification.
-- New callers may pass p_summary and include headline/update_type in each
-- update object.

CREATE OR REPLACE FUNCTION public.ingest_event(
  p_title   TEXT,
  p_status  TEXT,
  p_updates JSONB,           -- array of {content, source_name, source_url?, headline?, update_type?}
  p_summary TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id   UUID;
  v_update     JSONB;
  v_title      TEXT;
  v_idx        INT := 0;
  v_update_type TEXT;
BEGIN
  -- ── Input validation ─────────────────────────────────────────────────

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
    -- Validate update_type if provided
    v_update_type := v_update->>'update_type';
    IF v_update_type IS NOT NULL AND
       v_update_type NOT IN ('development', 'breaking', 'context', 'correction') THEN
      RAISE EXCEPTION
        'ingest_event: update[%] has invalid update_type "%". Valid: development, breaking, context, correction',
        v_idx, v_update_type;
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

  INSERT INTO public.events (title, status, summary)
  VALUES (v_title, p_status, p_summary)
  RETURNING id INTO v_event_id;

  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    INSERT INTO public.event_updates (event_id, content, source_name, source_url, headline, update_type)
    VALUES (
      v_event_id,
      v_update->>'content',
      v_update->>'source_name',
      v_update->>'source_url',
      v_update->>'headline',
      v_update->>'update_type'
    );
  END LOOP;

  RETURN v_event_id;
END;
$$;

-- Permissions: internal function, service_role only.
-- Must revoke both old and new signatures.
REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB, TEXT) TO service_role;
