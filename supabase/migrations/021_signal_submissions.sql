-- Migration 021: signal_submissions table
-- Stores user-submitted signals / leads for IRIS review.
-- These are NOT public comments — they feed the backend intelligence pipeline.

CREATE TABLE IF NOT EXISTS public.signal_submissions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Optional: the event this signal may relate to (set when submitted from detail page).
  event_id   UUID        REFERENCES public.events(id) ON DELETE SET NULL,
  content    TEXT        NOT NULL,
  -- Status is managed by the backend pipeline, not the user.
  status     TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'reviewed', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT signal_content_length CHECK (char_length(content) BETWEEN 1 AND 140)
);

CREATE INDEX IF NOT EXISTS idx_signal_submissions_user_id
  ON public.signal_submissions (user_id);

CREATE INDEX IF NOT EXISTS idx_signal_submissions_event_id
  ON public.signal_submissions (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_submissions_created_at
  ON public.signal_submissions (created_at DESC);

-- RLS
ALTER TABLE public.signal_submissions ENABLE ROW LEVEL SECURITY;

-- Users can insert their own signals.
CREATE POLICY "Users can insert own signals"
  ON public.signal_submissions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own submissions only.
CREATE POLICY "Users can view own signals"
  ON public.signal_submissions FOR SELECT
  USING (auth.uid() = user_id);
