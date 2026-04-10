-- 011_atomic_ingest_function.sql
--
-- Provides an atomic server-side ingestion function for the ingest script.
--
-- PROBLEMS fixed:
--
-- ── 1: Orphaned event on partial failure ─────────────────────────────────
--
--   ingest.ts inserts the event row first, then inserts updates in a second
--   round-trip. If the updates INSERT fails (network error, constraint
--   violation, etc.) the event row is already committed. The result is an
--   orphaned events row with no updates and source_count = 0. No cleanup
--   occurs because the client returns early after logging the error.
--
--   FIX: merge both inserts into a single PL/pgSQL function. All writes
--   execute inside one transaction. If any INSERT raises an exception,
--   Postgres rolls back the entire transaction — no orphan is possible.
--
-- ── 2: TOCTOU race in duplicate check ────────────────────────────────────
--
--   ingest.ts does a duplicate check SELECT, then a separate INSERT.
--   Two concurrent ingest processes with the same title can both pass the
--   check before either inserts, producing duplicate events.
--
--   FIX: use pg_advisory_xact_lock(key1, key2) before the duplicate check.
--   The lock is keyed on (42, hashtext(title)) — 42 is a fixed namespace
--   to avoid collisions with other advisory locks in the system.
--   The lock is transaction-scoped and released automatically on commit or
--   rollback. Concurrent calls with the same title serialize here;
--   the second caller then finds the row inserted by the first and returns
--   NULL (duplicate skipped).
--
-- ── 3: Round-trips reduced ───────────────────────────────────────────────
--
--   Two client→DB round-trips (INSERT event + INSERT updates) → one RPC call.
--
-- RETURN VALUE:
--   UUID  — the new event's id (insertion succeeded)
--   NULL  — duplicate detected within the last 10 minutes (skipped)
--
-- ACCESS: REVOKE from PUBLIC, GRANT to service_role only.
--   The ingest script always uses the service-role key; no end-user path
--   should ever call this function.

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
BEGIN
  -- Serialize concurrent calls for the same title using a transaction-scoped
  -- advisory lock. Key: (namespace=42, hash=hashtext(p_title)).
  -- The second caller blocks here until the first transaction commits,
  -- then re-checks the duplicate guard below with the committed state.
  PERFORM pg_advisory_xact_lock(42, hashtext(p_title));

  -- Duplicate guard: same title within the last 10 minutes
  SELECT id
  INTO v_event_id
  FROM public.events
  WHERE title = p_title
    AND created_at >= NOW() - INTERVAL '10 minutes'
  LIMIT 1;

  IF v_event_id IS NOT NULL THEN
    RETURN NULL;  -- duplicate — caller should log and skip
  END IF;

  -- Insert the event row
  INSERT INTO public.events (title, status)
  VALUES (p_title, p_status)
  RETURNING id INTO v_event_id;

  -- Insert all updates atomically in the same transaction.
  -- If any iteration raises an exception, the whole transaction rolls back
  -- (including the event insert above) — no orphan is left behind.
  FOR v_update IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    INSERT INTO public.event_updates (event_id, content, source_name, source_url)
    VALUES (
      v_event_id,
      v_update->>'content',
      v_update->>'source_name',
      v_update->>'source_url'   -- NULL when key is absent in JSON
    );
  END LOOP;

  RETURN v_event_id;
END;
$$;

-- This is an internal server-side function. No end-user role should call it.
REVOKE EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) FROM PUBLIC;
-- The ingest script uses the service-role key and is the only caller.
GRANT EXECUTE ON FUNCTION public.ingest_event(TEXT, TEXT, JSONB) TO service_role;
