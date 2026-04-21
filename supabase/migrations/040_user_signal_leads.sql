-- 040_user_signal_leads.sql
--
-- Adds user-submitted signal leads — a separate ingestion input layer distinct
-- from the Confirm/Dispute system.
--
-- WHAT A SIGNAL LEAD IS:
--   Text-only user input (≤ 140 chars) submitted as potential new information.
--   It feeds the IRIS ingestion pipeline, not a social graph.
--
-- WHAT A SIGNAL LEAD IS NOT:
--   - A comment, reply, or discussion thread
--   - A direct event edit
--   - A media submission
--   - A replacement for Confirm/Dispute
--
-- STATUS MACHINE:
--   pending               → awaiting pipeline evaluation
--   matched_existing_event → evaluated: event_update created for a matched event
--   created_new_event      → evaluated: new event created from this lead
--   rejected               → rejected (low_value | misleading | irrelevant | duplicate)
--   rate_limited           → blocked by cooldown or daily cap (stored for audit)
--   blocked                → user is in a temporary block period
--
--   Status transitions pending → * are performed by the processing service
--   (TypeScript ingestion worker), not by this migration.
--
-- RATE LIMITING (enforced in submit_signal_lead):
--   Cooldown:   5 minutes between accepted submissions (not counted for rate_limited)
--   Daily cap:  reputation-gated — see migration 039 for thresholds
--   Block:      blocked_until from user_reputation checked first
--
-- CONTENT VALIDATION (enforced in submit_signal_lead + DB constraint):
--   Min: 10 characters (trimmed)
--   Max: 140 characters (matches historical Twitter limit; fits inline UI displays)
--
-- CONTEXT MATCHING:
--   p_context_event_id may be provided when submitting from an event detail page.
--   It is optional metadata for the pipeline — it does NOT mean direct event mutation.
--   If the referenced event is archived or invisible at submission time, the
--   context is silently cleared (not an error).
--
-- REPUTATION IMPACT:
--   Written by the processing pipeline after evaluation.
--   +5 accepted, -5 rejected, -15 misleading strike.
--   Three misleading strikes in 30 days → 24-hour block.
--
-- PROCESSING HOOK:
--   The TypeScript processing worker queries pending leads via:
--     SELECT * FROM user_signal_leads WHERE status = 'pending' ORDER BY created_at
--   and processes them through the event matching / creation pipeline.


-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE public.user_signal_leads (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content           TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  context_event_id  UUID        REFERENCES public.events(id) ON DELETE SET NULL,
  matched_event_id  UUID        REFERENCES public.events(id) ON DELETE SET NULL,
  created_update_id UUID        REFERENCES public.event_updates(id) ON DELETE SET NULL,
  rejection_reason  TEXT,
  reputation_impact INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,

  CONSTRAINT lead_content_length CHECK (
    char_length(trim(content)) >= 10 AND char_length(content) <= 140
  ),
  CONSTRAINT lead_status_check CHECK (status IN (
    'pending',
    'matched_existing_event',
    'created_new_event',
    'rejected',
    'rate_limited',
    'blocked'
  ))
);

-- Per-user history (used by get_my_signal_leads and cooldown check)
CREATE INDEX idx_signal_leads_user_created
  ON public.user_signal_leads (user_id, created_at DESC);

-- Processing queue index (used by the ingestion worker to pick up pending leads)
CREATE INDEX idx_signal_leads_pending
  ON public.user_signal_leads (created_at)
  WHERE status = 'pending';

-- Reverse-lookup: which leads matched a given event
CREATE INDEX idx_signal_leads_matched_event
  ON public.user_signal_leads (matched_event_id)
  WHERE matched_event_id IS NOT NULL;


-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_signal_leads ENABLE ROW LEVEL SECURITY;

-- Authenticated: read own leads.
CREATE POLICY "leads_read_own" ON public.user_signal_leads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- RESTRICTIVE: all mutations via submit_signal_lead RPC (service_role bypasses).
CREATE POLICY "deny_leads_writes" ON public.user_signal_leads
  AS RESTRICTIVE FOR ALL
  USING (false) WITH CHECK (false);

-- RESTRICTIVE: anon has no access.
CREATE POLICY "deny_leads_anon" ON public.user_signal_leads
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);


-- ── RPC: submit_signal_lead ───────────────────────────────────────────────────
--
-- Guarded submission entry point for authenticated users.
--
-- Enforcement order:
--   1. Auth check              → EXCEPTION (not stored)
--   2. Content validation      → EXCEPTION (not stored)
--   3. Reputation row safety net (upsert)
--   4. Block check             → status='blocked'   (stored for audit)
--   5. Daily cap               → status='rate_limited' (stored for audit)
--   6. Cooldown check          → status='rate_limited' (stored for audit)
--   7. context_event_id clear  → silently set to NULL if event is invalid
--   8. Insert pending lead
--   9. Increment total_leads on reputation
--
-- Returns JSONB: { lead_id UUID, status TEXT, message TEXT, [blocked_until] }

CREATE FUNCTION public.submit_signal_lead(
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
  v_lead_count_today   INTEGER;
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
  -- Bootstrap the row if handle_new_user did not fire (e.g. existing accounts
  -- before migration 039, or a transient trigger failure).
  INSERT INTO public.user_reputation (user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_rep
  FROM public.user_reputation
  WHERE user_id = v_user_id;

  -- ── Block check ───────────────────────────────────────────────────────────
  IF v_rep.blocked_until IS NOT NULL AND v_rep.blocked_until > NOW() THEN
    INSERT INTO public.user_signal_leads (user_id, content, status, context_event_id)
    VALUES (v_user_id, p_content, 'blocked', v_context_event_id)
    RETURNING id INTO v_lead_id;

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
    INSERT INTO public.user_signal_leads (user_id, content, status, context_event_id)
    VALUES (v_user_id, p_content, 'rate_limited', v_context_event_id)
    RETURNING id INTO v_lead_id;

    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'status',  'rate_limited',
      'message', format('Daily lead limit (%s) reached. Try again tomorrow.', v_daily_cap)
    );
  END IF;

  -- ── Cooldown check ────────────────────────────────────────────────────────
  -- Checks for any accepted/pending submission in the cooldown window.
  -- rate_limited and blocked submissions are excluded so they don't extend
  -- the cooldown inadvertently.
  SELECT MAX(created_at) INTO v_last_lead_at
  FROM public.user_signal_leads
  WHERE user_id   = v_user_id
    AND status    NOT IN ('rate_limited', 'blocked')
    AND created_at >= NOW() - make_interval(mins => v_cooldown_minutes);

  IF v_last_lead_at IS NOT NULL THEN
    INSERT INTO public.user_signal_leads (user_id, content, status, context_event_id)
    VALUES (v_user_id, p_content, 'rate_limited', v_context_event_id)
    RETURNING id INTO v_lead_id;

    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'status',  'rate_limited',
      'message', format('Please wait %s minutes between lead submissions.', v_cooldown_minutes)
    );
  END IF;

  -- ── context_event_id validation ───────────────────────────────────────────
  -- The context is optional metadata; clearing it is not an error.
  -- Cleared if: event doesn't exist, is archived, or is not publicly visible.
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

  -- Increment lifetime lead counter (reputation_impact written by processor)
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


-- ── RPC: get_my_signal_leads ──────────────────────────────────────────────────
--
-- Returns the calling user's lead submissions, most-recent first.
-- Excludes internal columns (user_id). Pagination via limit/offset.

CREATE FUNCTION public.get_my_signal_leads(
  p_limit  INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id                UUID,
  content           TEXT,
  status            TEXT,
  context_event_id  UUID,
  matched_event_id  UUID,
  rejection_reason  TEXT,
  reputation_impact INTEGER,
  created_at        TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    content,
    status,
    context_event_id,
    matched_event_id,
    rejection_reason,
    reputation_impact,
    created_at,
    processed_at
  FROM public.user_signal_leads
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT  GREATEST(1, LEAST(COALESCE(p_limit,  20), 100))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_signal_leads(INTEGER, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_signal_leads(INTEGER, INTEGER) TO authenticated;
