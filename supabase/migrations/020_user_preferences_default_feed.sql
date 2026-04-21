-- Migration 020: user_preferences table + default_feed column
-- Idempotent: safe to run even if table partially exists.

-- Create user_preferences if it doesn't exist yet.
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme      TEXT        NOT NULL DEFAULT 'system'
                         CHECK (theme IN ('system', 'light', 'dark')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add default_feed column (idempotent via IF NOT EXISTS on PG 9.6+).
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS default_feed TEXT NOT NULL DEFAULT 'new'
  CHECK (default_feed IN ('new', 'verified', 'rising'));

-- RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read their own row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_preferences' AND policyname = 'Users can view own preferences'
  ) THEN
    CREATE POLICY "Users can view own preferences"
      ON public.user_preferences FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Users can upsert their own row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_preferences' AND policyname = 'Users can upsert own preferences'
  ) THEN
    CREATE POLICY "Users can upsert own preferences"
      ON public.user_preferences FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
