-- 041_event_title_summary_evolution.sql
--
-- Adds controlled, auditable evolution of event title and summary.
--
-- PRODUCT CONTEXT:
--   Events are system-owned and not directly user-editable. Titles and summaries
--   are derived from source material during ingestion. As higher-quality sources
--   report on an event, the canonical description may improve — more precise
--   location, confirmed casualty figures, corrected initial framing.
--
-- DESIGN PRINCIPLES:
--   - Deterministic rule-based logic: no LLM/ML in this migration layer.
--     All acceptance decisions are reproducible and auditable from the revision log.
--   - Append-only audit log: every accepted change produces an event_revisions row.
--   - Conservative acceptance: minor rewording does not qualify; material additions
--     or precision improvements do. "When in doubt, don't evolve."
--   - Event identity is preserved: slug, id, created_at, and follow associations
--     are never altered. Only title and summary may change.
--
-- SCHEMA:
--   event_revisions — append-only history of title/summary changes.
--   Fields capture old/new values, trigger reason, and which source update caused
--   the evolution (source_update_id links back to event_updates.id).
--
-- evolve_event_metadata ACCEPTANCE RULES:
--
--   TITLE (must satisfy ≥ 1):
--     a) Proposed title is at least 80% the length of the current title
--        (prevents aggressive truncation/vague rewrites)
--     b) Proposed title is ≥ 15 chars longer than current
--        (clearly more specific — location, actor, confirmed figure added)
--
--   SUMMARY (must satisfy ≥ 1):
--     a) Current summary is NULL (first population)
--     b) Proposed summary is > 20 chars longer (material expansion of context)
--     c) Proposed summary is within 70% of current length but text differs
--        (same-scale rewrite — covers correction or clarification)
--
--   In both cases: proposed value must be non-empty, trimmed, and different from
--   the current value. Identical values → no-op.
--
-- CALLER CONTRACT:
--   Service-role only. Typical call site: TypeScript ingestion worker after
--   attach_item_to_event when the normalized item carries a high-confidence
--   title/summary candidate.
--
--   Example call:
--     SELECT evolve_event_metadata(
--       p_event_id     := '<uuid>',
--       p_new_title    := 'Earthquake M5.4 — Tashkent, Uzbekistan (USGS confirmed)',
--       p_new_summary  := 'A 5.4-magnitude earthquake struck 12km south-west of Tashkent...',
--       p_reason       := 'USGS official confirmation added precise location',
--       p_update_id    := '<event_update uuid>',
--       p_triggered_by := 'ingestion'
--     );
--
-- PERMISSIONS:
--   REVOKE from PUBLIC. GRANT to service_role.
--   Authenticated users cannot call this function.


-- ── event_revisions table ─────────────────────────────────────────────────────

CREATE TABLE public.event_revisions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  revision_type    TEXT        NOT NULL
                               CHECK (revision_type IN ('title', 'summary', 'both')),
  old_title        TEXT,
  new_title        TEXT,
  old_summary      TEXT,
  new_summary      TEXT,
  trigger_reason   TEXT,
  triggered_by     TEXT        NOT NULL DEFAULT 'ingestion'
                               CHECK (triggered_by IN ('ingestion', 'recompute', 'manual_admin')),
  source_update_id UUID        REFERENCES public.event_updates(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-event timeline of revisions (app may show "title changed from X to Y")
CREATE INDEX idx_event_revisions_event
  ON public.event_revisions (event_id, created_at DESC);


-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.event_revisions ENABLE ROW LEVEL SECURITY;

-- Public read: consistent with the events table itself (no auth required to read).
-- The app can display revision history on the event detail page.
CREATE POLICY "revisions_public_read" ON public.event_revisions
  FOR SELECT USING (true);

-- RESTRICTIVE: all writes via evolve_event_metadata (service_role only).
CREATE POLICY "deny_revisions_writes" ON public.event_revisions
  AS RESTRICTIVE FOR ALL
  USING (false) WITH CHECK (false);


-- ── evolve_event_metadata ─────────────────────────────────────────────────────

CREATE FUNCTION public.evolve_event_metadata(
  p_event_id     UUID,
  p_new_title    TEXT    DEFAULT NULL,
  p_new_summary  TEXT    DEFAULT NULL,
  p_reason       TEXT    DEFAULT NULL,
  p_update_id    UUID    DEFAULT NULL,
  p_triggered_by TEXT    DEFAULT 'ingestion'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event          public.events%ROWTYPE;
  v_title_ok       BOOLEAN := FALSE;
  v_summary_ok     BOOLEAN := FALSE;
  v_revision_type  TEXT;
  v_norm_title     TEXT;
  v_norm_summary   TEXT;
BEGIN
  -- ── Parameter validation ──────────────────────────────────────────────────
  IF p_triggered_by NOT IN ('ingestion', 'recompute', 'manual_admin') THEN
    RAISE EXCEPTION 'evolve_event_metadata: invalid triggered_by "%"', p_triggered_by;
  END IF;

  IF p_new_title IS NULL AND p_new_summary IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'no candidates provided');
  END IF;

  -- ── Lock event row ────────────────────────────────────────────────────────
  -- Serializes concurrent evolution attempts for the same event (same pattern
  -- as recompute_event_state). Prevents two workers from racing to set title.
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evolve_event_metadata: event % not found', p_event_id;
  END IF;

  -- Normalize: strip leading/trailing whitespace from candidates
  v_norm_title   := trim(COALESCE(p_new_title,   ''));
  v_norm_summary := trim(COALESCE(p_new_summary, ''));

  -- ── Title acceptance rules ────────────────────────────────────────────────
  IF p_new_title IS NOT NULL
     AND v_norm_title <> ''
     AND v_norm_title <> COALESCE(v_event.title, '') THEN

    IF (
      -- Rule a: proposed title is not a truncation/simplification (≥80% of current)
      char_length(v_norm_title) >= char_length(COALESCE(v_event.title, '')) * 0.80
      -- Rule b: proposed title is materially more specific (≥15 extra chars)
      OR char_length(v_norm_title) > char_length(COALESCE(v_event.title, '')) + 15
    ) THEN
      v_title_ok := TRUE;
    END IF;
  END IF;

  -- ── Summary acceptance rules ──────────────────────────────────────────────
  IF p_new_summary IS NOT NULL
     AND v_norm_summary <> ''
     AND v_norm_summary <> COALESCE(v_event.summary, '') THEN

    IF (
      -- Rule a: first population of summary
      v_event.summary IS NULL
      -- Rule b: material expansion (new summary adds >20 chars of context)
      OR char_length(v_norm_summary) > char_length(COALESCE(v_event.summary, '')) + 20
      -- Rule c: same-scale rewrite within 70% length guard (correction/clarification)
      OR char_length(v_norm_summary) >= char_length(COALESCE(v_event.summary, '')) * 0.70
    ) THEN
      v_summary_ok := TRUE;
    END IF;
  END IF;

  -- ── Early return if nothing qualifies ─────────────────────────────────────
  IF NOT v_title_ok AND NOT v_summary_ok THEN
    RETURN jsonb_build_object(
      'updated', false,
      'reason',  'candidates did not meet evolution criteria'
    );
  END IF;

  -- ── Revision type label ───────────────────────────────────────────────────
  v_revision_type := CASE
    WHEN v_title_ok AND v_summary_ok THEN 'both'
    WHEN v_title_ok                   THEN 'title'
    ELSE                                   'summary'
  END;

  -- ── Audit record ─────────────────────────────────────────────────────────
  INSERT INTO public.event_revisions (
    event_id,
    revision_type,
    old_title,
    new_title,
    old_summary,
    new_summary,
    trigger_reason,
    triggered_by,
    source_update_id
  ) VALUES (
    p_event_id,
    v_revision_type,
    CASE WHEN v_title_ok   THEN v_event.title   ELSE NULL END,
    CASE WHEN v_title_ok   THEN v_norm_title    ELSE NULL END,
    CASE WHEN v_summary_ok THEN v_event.summary ELSE NULL END,
    CASE WHEN v_summary_ok THEN v_norm_summary  ELSE NULL END,
    p_reason,
    p_triggered_by,
    p_update_id
  );

  -- ── Apply changes ─────────────────────────────────────────────────────────
  UPDATE public.events
  SET
    title           = CASE WHEN v_title_ok   THEN v_norm_title   ELSE title   END,
    summary         = CASE WHEN v_summary_ok THEN v_norm_summary ELSE summary END,
    last_updated_at = NOW()
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'updated',         true,
    'revision_type',   v_revision_type,
    'title_changed',   v_title_ok,
    'summary_changed', v_summary_ok
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.evolve_event_metadata(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.evolve_event_metadata(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;
