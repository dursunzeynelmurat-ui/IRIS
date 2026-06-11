-- 042_policy_and_lead_guard_fixes.sql
--
-- Fixes three issues found in post-merge review of migrations 039–041.
-- Fix-forward migration: 039–041 may already be applied, so this corrects
-- live state rather than editing those files.
--
-- 1. RESTRICTIVE FOR ALL deny policies blocked reads.
--    Restrictive policies are ANDed with permissive ones for every command
--    they cover. "AS RESTRICTIVE FOR ALL ... USING (false)" therefore vetoes
--    SELECT as well, making these permissive read policies dead:
--      user_reputation.rep_read_own
--      user_signal_leads.leads_read_own
--      event_revisions.revisions_public_read
--    (The SECURITY DEFINER RPCs still worked because the function owner
--    bypasses RLS — direct table reads were what broke.)
--    Fix: drop the FOR ALL denies and recreate them scoped to writes only.
--    Reads flow through the permissive policies; writes stay denied both by
--    the absence of permissive write policies and by these explicit denies.
--
-- 2. submit_signal_lead allowed unbounded audit-row inserts.
--    Every rate_limited/blocked attempt inserted a row with no cap, so a
--    hostile client could grow the table without limit by hammering the RPC.
--    Fix: keep at most 5 audit rows (rate_limited/blocked) per user per hour;
--    beyond that the RPC returns the same status JSONB without inserting.
--    lead_id is NULL in that case.
--
-- 3. evolve_event_metadata acceptance rules were too permissive.
--    The rules OR-ed what were designed as guards:
--      title:   accepted if ≥80% of current length OR ≥15 chars longer
--               → almost any differing title passed (the 80% anti-truncation
--                 guard acted as a sufficient condition)
--      summary: accepted if ≥70% of current length (rule c)
--               → any same-scale rewrite passed, contradicting
--                 "do not rewrite on every minor update"
--    Fix:
--      title (ingestion/recompute): must be ≥80% of current length AND
--        ≥15 chars longer — anti-truncation guard AND material addition.
--      summary (ingestion/recompute): first population OR >20 chars longer.
--      manual_admin: any valid differing value is accepted for both fields
--        (admin corrections may shorten or reframe).


-- ── 1a. user_reputation: scope deny to writes ────────────────────────────────

DROP POLICY IF EXISTS "deny_rep_writes" ON public.user_reputation;

CREATE POLICY "deny_rep_insert" ON public.user_reputation
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

CREATE POLICY "deny_rep_update" ON public.user_reputation
  AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_rep_delete" ON public.user_reputation
  AS RESTRICTIVE FOR DELETE
  USING (false);


-- ── 1b. user_signal_leads: scope deny to writes ──────────────────────────────

DROP POLICY IF EXISTS "deny_leads_writes" ON public.user_signal_leads;

CREATE POLICY "deny_leads_insert" ON public.user_signal_leads
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

CREATE POLICY "deny_leads_update" ON public.user_signal_leads
  AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_leads_delete" ON public.user_signal_leads
  AS RESTRICTIVE FOR DELETE
  USING (false);


-- ── 1c. event_revisions: scope deny to writes ────────────────────────────────

DROP POLICY IF EXISTS "deny_revisions_writes" ON public.event_revisions;

CREATE POLICY "deny_revisions_insert" ON public.event_revisions
  AS RESTRICTIVE FOR INSERT
  WITH CHECK (false);

CREATE POLICY "deny_revisions_update" ON public.event_revisions
  AS RESTRICTIVE FOR UPDATE
  USING (false) WITH CHECK (false);

CREATE POLICY "deny_revisions_delete" ON public.event_revisions
  AS RESTRICTIVE FOR DELETE
  USING (false);


-- ── 2. submit_signal_lead: cap audit-row inserts ─────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_signal_lead(
  p_content          TEXT,
  p_context_event_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_rep                public.user_reputation%ROWTYPE;
  v_lead_id            UUID;
  v_daily_cap          INTEGER;
  v_cooldown_minutes   CONSTANT INTEGER := 5;
  v_audit_hourly_cap   CONSTANT INTEGER := 5;
  v_lead_count_today   INTEGER;
  v_audit_count_hour   INTEGER;
  v_last_lead_at       TIMESTAMPTZ;
  v_context_event_id   UUID := p_context_event_id;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'submit_signal_lead: authentication required';
  END IF;

  -- ── Content validation ────────────────────────────────────────────────────
  IF p_content IS NULL OR char_length(trim(p_content)) < 10 THEN
    RAISE EXCEPTION 'submit_signal_lead: content must be at least 10 characters';
  END IF;
  IF char_length(p_content) > 140 THEN
    RAISE EXCEPTION 'submit_signal_lead: content must not exceed 140 characters';
  END IF;

  -- ── Reputation safety net ─────────────────────────────────────────────────
  INSERT INTO public.user_reputation (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_rep
  FROM public.user_reputation
  WHERE user_id = v_user_id;

  -- ── Audit-row flood guard ─────────────────────────────────────────────────
  -- rate_limited / blocked rows are audit records. Cap them so repeated
  -- attempts cannot grow the table without bound.
  SELECT COUNT(*) INTO v_audit_count_hour
  FROM public.user_signal_leads
  WHERE user_id    = v_user_id
    AND status     IN ('rate_limited', 'blocked')
    AND created_at >= NOW() - INTERVAL '1 hour';

  -- ── Block check ───────────────────────────────────────────────────────────
  IF v_rep.blocked_until IS NOT NULL AND v_rep.blocked_until > NOW() THEN
    IF v_audit_count_hour < v_audit_hourly_cap THEN
      INSERT INTO public.user_signal_leads (user_id, content, status, context_event_id)
      VALUES (v_user_id, trim(p_content), 'blocked', v_context_event_id)
      RETURNING id INTO v_lead_id;
    END IF;

    RETURN jsonb_build_object(
      'lead_id',      v_lead_id,
      'status',       'blocked',
      'message',      'Your account is temporarily restricted from submitting leads.',
      'blocked_until', v_rep.blocked_until
    );
  END IF;

  -- ── Daily cap (reputation-gated) ──────────────────────────────────────────
  v_daily_cap := CASE
    WHEN v_rep.reputation_score <  30 THEN 2
    WHEN v_rep.reputation_score <  60 THEN 5
    WHEN v_rep.reputation_score < 100 THEN 10
    ELSE 20
  END;

  SELECT COUNT(*) INTO v_lead_count_today
  FROM public.user_signal_leads
  WHERE user_id   = v_user_id
    AND created_at >= NOW() - INTERVAL '24 hours'
    AND status NOT IN ('rate_limited', 'blocked');

  IF v_lead_count_today >= v_daily_cap THEN
    IF v_audit_count_hour < v_audit_hourly_cap THEN
      INSERT INTO public.user_signal_leads (user_id, content, status, context_event_id)
      VALUES (v_user_id, trim(p_content), 'rate_limited', v_context_event_id)
      RETURNING id INTO v_lead_id;
    END IF;

    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'status',  'rate_limited',
      'message', format('Daily lead limit (%s) reached. Try again tomorrow.', v_daily_cap)
    );
  END IF;

  -- ── Cooldown check ────────────────────────────────────────────────────────
  SELECT MAX(created_at) INTO v_last_lead_at
  FROM public.user_signal_leads
  WHERE user_id   = v_user_id
    AND status    NOT IN ('rate_limited', 'blocked')
    AND created_at >= NOW() - make_interval(mins => v_cooldown_minutes);

  IF v_last_lead_at IS NOT NULL THEN
    IF v_audit_count_hour < v_audit_hourly_cap THEN
      INSERT INTO public.user_signal_leads (user_id, content, status, context_event_id)
      VALUES (v_user_id, trim(p_content), 'rate_limited', v_context_event_id)
      RETURNING id INTO v_lead_id;
    END IF;

    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'status',  'rate_limited',
      'message', format('Please wait %s minutes between lead submissions.', v_cooldown_minutes)
    );
  END IF;

  -- ── context_event_id validation ───────────────────────────────────────────
  IF v_context_event_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.events
      WHERE id         = v_context_event_id
        AND status    <> 'archived'
        AND visibility = 'visible'
    ) THEN
      v_context_event_id := NULL;
    END IF;
  END IF;

  -- ── Insert pending lead ───────────────────────────────────────────────────
  INSERT INTO public.user_signal_leads (user_id, content, status, context_event_id)
  VALUES (v_user_id, trim(p_content), 'pending', v_context_event_id)
  RETURNING id INTO v_lead_id;

  UPDATE public.user_reputation
  SET total_leads = total_leads + 1,
      updated_at  = NOW()
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'lead_id', v_lead_id,
    'status',  'pending',
    'message', 'Your lead has been submitted and will be reviewed.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_signal_lead(TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.submit_signal_lead(TEXT, UUID) TO authenticated;


-- ── 3. evolve_event_metadata: corrected acceptance rules ─────────────────────

CREATE OR REPLACE FUNCTION public.evolve_event_metadata(
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
  v_is_admin       BOOLEAN;
  v_revision_type  TEXT;
  v_norm_title     TEXT;
  v_norm_summary   TEXT;
BEGIN
  IF p_triggered_by NOT IN ('ingestion', 'recompute', 'manual_admin') THEN
    RAISE EXCEPTION 'evolve_event_metadata: invalid triggered_by "%"', p_triggered_by;
  END IF;

  IF p_new_title IS NULL AND p_new_summary IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'no candidates provided');
  END IF;

  v_is_admin := (p_triggered_by = 'manual_admin');

  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evolve_event_metadata: event % not found', p_event_id;
  END IF;

  v_norm_title   := trim(COALESCE(p_new_title,   ''));
  v_norm_summary := trim(COALESCE(p_new_summary, ''));

  -- ── Title acceptance ──────────────────────────────────────────────────────
  -- Automated paths require BOTH: not a truncation (≥80% of current length)
  -- AND a material addition (≥15 chars longer). Admin corrections are exempt —
  -- they may legitimately shorten or reframe.
  IF p_new_title IS NOT NULL
     AND v_norm_title <> ''
     AND v_norm_title <> COALESCE(v_event.title, '') THEN

    IF v_is_admin THEN
      v_title_ok := TRUE;
    ELSIF char_length(v_norm_title) >= char_length(COALESCE(v_event.title, '')) * 0.80
      AND char_length(v_norm_title) >= char_length(COALESCE(v_event.title, '')) + 15 THEN
      v_title_ok := TRUE;
    END IF;
  END IF;

  -- ── Summary acceptance ────────────────────────────────────────────────────
  -- Automated paths: first population, or a material expansion (>20 chars).
  -- Same-length rewording does NOT qualify — "when in doubt, don't evolve".
  -- Admin corrections are exempt.
  IF p_new_summary IS NOT NULL
     AND v_norm_summary <> ''
     AND v_norm_summary <> COALESCE(v_event.summary, '') THEN

    IF v_is_admin THEN
      v_summary_ok := TRUE;
    ELSIF v_event.summary IS NULL THEN
      v_summary_ok := TRUE;
    ELSIF char_length(v_norm_summary) > char_length(v_event.summary) + 20 THEN
      v_summary_ok := TRUE;
    END IF;
  END IF;

  IF NOT v_title_ok AND NOT v_summary_ok THEN
    RETURN jsonb_build_object(
      'updated', false,
      'reason',  'candidates did not meet evolution criteria'
    );
  END IF;

  v_revision_type := CASE
    WHEN v_title_ok AND v_summary_ok THEN 'both'
    WHEN v_title_ok                   THEN 'title'
    ELSE                                   'summary'
  END;

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
