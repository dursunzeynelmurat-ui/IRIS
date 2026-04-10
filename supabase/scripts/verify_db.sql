-- verify_db.sql
--
-- Read-only verification script for the IRIS database schema.
-- Run after applying all migrations (001–016) to confirm expected state.
-- All queries are SELECT-only — safe to run against production.
--
-- Usage: Paste into Supabase SQL Editor (or psql) and run.
--        Review each section for PASS / FAIL indicators.
--
-- ── Section 1: RLS enabled on all tables ──────────────────────────────────

SELECT
  relname        AS "table",
  relrowsecurity AS "rls_enabled",
  CASE WHEN relrowsecurity THEN 'PASS' ELSE 'FAIL ← RLS must be ON' END AS status
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN ('events', 'event_updates', 'signals', 'users')
ORDER BY relname;

-- ── Section 2: All policies on core tables (informational) ────────────────

SELECT
  tablename,
  policyname,
  cmd,
  roles,
  CASE WHEN permissive = 'PERMISSIVE' THEN 'permissive' ELSE 'RESTRICTIVE' END AS type,
  qual   AS using_expr,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('events', 'event_updates', 'signals', 'users')
ORDER BY tablename, policyname;

-- ── Section 3: RESTRICTIVE deny policies — all 12 required ───────────────
--
-- After migrations 004, 005, 007, 010 the following RESTRICTIVE policies
-- must exist. Any missing row = FAIL.

WITH expected_restrictive AS (
  SELECT * FROM (VALUES
    -- migration 004
    ('events',        'deny_events_insert'),
    ('events',        'deny_events_update'),
    ('events',        'deny_events_delete'),
    ('event_updates', 'deny_event_updates_update'),
    ('event_updates', 'deny_event_updates_delete'),
    ('users',         'deny_users_insert'),
    ('users',         'deny_users_update'),
    ('users',         'deny_users_delete'),
    -- migration 005
    ('event_updates', 'deny_event_updates_insert'),
    -- migration 007
    ('signals',       'deny_signals_delete'),
    -- migration 010
    ('signals',       'deny_signals_anon'),
    ('users',         'deny_users_anon')
  ) AS t(tbl, pol)
)
SELECT
  e.tbl   AS "table",
  e.pol   AS "policy",
  CASE
    WHEN p.policyname IS NULL    THEN 'FAIL ← POLICY MISSING'
    WHEN p.permissive <> 'RESTRICTIVE' THEN 'FAIL ← must be RESTRICTIVE'
    ELSE 'PASS'
  END AS status
FROM expected_restrictive e
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
  AND p.tablename = e.tbl
  AND p.policyname = e.pol
ORDER BY e.tbl, e.pol;

-- ── Section 4: SECURITY DEFINER functions with SET search_path ───────────

SELECT
  p.proname    AS "function",
  p.prosecdef  AS "security_definer",
  p.proconfig  AS "config",
  CASE
    WHEN NOT p.prosecdef
      THEN 'FAIL ← must be SECURITY DEFINER'
    WHEN NOT (p.proconfig @> ARRAY['search_path=public'])
      THEN 'FAIL ← missing SET search_path=public'
    ELSE 'PASS'
  END AS status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'recalculate_trust_score',
    'trigger_sync_trust_score',
    'sync_source_count',
    'validate_signal_immutable_fields',
    'handle_new_user',
    'ingest_event',
    'reconcile_source_counts',   -- migration 015
    'reconcile_trust_scores',    -- migration 015
    'compute_trust_score'        -- migration 016
  )
ORDER BY p.proname;

-- ── Section 5: Triggers on public tables ─────────────────────────────────
--
-- Note: on_auth_user_created / trg_on_auth_user_created lives on auth.users
-- (auth schema) and requires a separate query — see Section 6.

SELECT
  t.tgname   AS "trigger",
  c.relname  AS "table",
  CASE t.tgenabled
    WHEN 'O' THEN 'enabled'
    WHEN 'D' THEN 'DISABLED'
    ELSE t.tgenabled::text
  END AS state,
  CASE
    WHEN t.tgenabled = 'D' THEN 'FAIL ← trigger is disabled'
    ELSE 'PASS'
  END AS status
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND t.tgname IN (
    'signals_sync_trust_score',           -- AFTER INSERT OR UPDATE OR DELETE on signals (migrations 006, 013)
    'trg_sync_source_count',              -- AFTER INSERT OR DELETE on event_updates (migration 003)
    'signals_enforce_immutable_fields'    -- BEFORE UPDATE on signals (migration 009)
  )
ORDER BY c.relname, t.tgname;

-- ── Section 6: Auth trigger (auth schema) ────────────────────────────────

SELECT
  t.tgname   AS "trigger",
  c.relname  AS "table",
  n.nspname  AS "schema",
  CASE t.tgenabled
    WHEN 'O' THEN 'enabled'
    WHEN 'D' THEN 'DISABLED'
    ELSE t.tgenabled::text
  END AS state,
  CASE
    WHEN t.tgenabled = 'D' THEN 'FAIL ← trigger is disabled'
    ELSE 'PASS'
  END AS status
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth'
  AND c.relname = 'users'
  AND t.tgname = 'trg_on_auth_user_created';  -- migration 001

-- ── Section 7: EXECUTE permissions on internal functions ─────────────────
--
-- All internal functions must NOT be callable by anon or authenticated;
-- service_role must be able to call all of them.
-- compute_trust_score is a pure formula helper — still an internal
-- implementation detail, not a public API endpoint.

WITH checks AS (
  SELECT 'recalculate_trust_score(uuid)'   AS fn UNION ALL
  SELECT 'ingest_event(text,text,jsonb)'   UNION ALL
  SELECT 'reconcile_source_counts()'       UNION ALL
  SELECT 'reconcile_trust_scores()'        UNION ALL
  SELECT 'compute_trust_score(integer,integer)'  -- migration 016
),
roles AS (
  SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
)
SELECT
  c.fn,
  r.rolname AS "role",
  has_function_privilege(r.rolname, 'public.' || c.fn, 'execute') AS "can_execute",
  CASE
    WHEN r.rolname IN ('anon', 'authenticated') AND
         has_function_privilege(r.rolname, 'public.' || c.fn, 'execute')
      THEN 'FAIL ← must NOT be executable by ' || r.rolname
    WHEN r.rolname = 'service_role' AND
         NOT has_function_privilege(r.rolname, 'public.' || c.fn, 'execute')
      THEN 'FAIL ← service_role must be able to execute'
    ELSE 'PASS'
  END AS status
FROM checks c CROSS JOIN roles r
ORDER BY c.fn, r.rolname;

-- ── Section 8: Dead functions — must not exist ────────────────────────────

SELECT
  CASE WHEN count(*) = 0
    THEN 'PASS'
    ELSE 'FAIL ← dead function increment_source_count() still exists'
  END AS "increment_source_count_dropped"
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'increment_source_count';

-- ── Section 9: events.trust_score CHECK constraint ───────────────────────

SELECT
  conname              AS "constraint",
  pg_get_constraintdef(oid) AS "definition",
  'PASS'               AS status
FROM pg_constraint
WHERE conrelid = 'public.events'::regclass
  AND conname LIKE '%trust_score%';

-- Expected: CHECK (trust_score >= 0 AND trust_score <= 100)

-- ── Section 10: signals UNIQUE constraint (for upsert ON CONFLICT) ────────

SELECT
  conname              AS "constraint",
  pg_get_constraintdef(oid) AS "definition",
  'PASS'               AS status
FROM pg_constraint
WHERE conrelid = 'public.signals'::regclass
  AND contype = 'u';

-- Expected: UNIQUE (user_id, event_id)

-- ── Section 11: RESTRICTIVE deny policy expressions ───────────────────────
--
-- Section 3 confirms that each deny policy EXISTS and has type RESTRICTIVE.
-- This section confirms the expressions actually block access:
--
--   For INSERT policies (no USING clause):  qual IS NULL, with_check = 'false'
--   For DELETE policies (no WITH CHECK):    qual = 'false', with_check IS NULL
--   For UPDATE policies:                    qual = 'false', with_check = 'false'
--   For ALL policies (anon deny):           qual = 'false', with_check = 'false'
--
-- A RESTRICTIVE policy with USING (true) or USING (auth.uid() = user_id)
-- would satisfy Section 3 but silently fail to deny access.

WITH deny_policies AS (
  SELECT * FROM (VALUES
    ('events',        'deny_events_insert'),
    ('events',        'deny_events_update'),
    ('events',        'deny_events_delete'),
    ('event_updates', 'deny_event_updates_update'),
    ('event_updates', 'deny_event_updates_delete'),
    ('event_updates', 'deny_event_updates_insert'),
    ('users',         'deny_users_insert'),
    ('users',         'deny_users_update'),
    ('users',         'deny_users_delete'),
    ('signals',       'deny_signals_delete'),
    ('signals',       'deny_signals_anon'),
    ('users',         'deny_users_anon')
  ) AS t(tbl, pol)
)
SELECT
  d.tbl   AS "table",
  d.pol   AS "policy",
  p.cmd,
  p.qual       AS "using_expr",
  p.with_check AS "with_check_expr",
  CASE
    WHEN p.policyname IS NULL
      THEN 'FAIL ← policy missing (check Section 3)'
    -- USING clause present but not 'false'
    WHEN p.qual IS NOT NULL AND p.qual <> 'false'
      THEN 'FAIL ← USING is not false: ' || p.qual
    -- WITH CHECK clause present but not 'false'
    WHEN p.with_check IS NOT NULL AND p.with_check <> 'false'
      THEN 'FAIL ← WITH CHECK is not false: ' || p.with_check
    -- Neither clause present (degenerate policy — blocks nothing)
    WHEN p.qual IS NULL AND p.with_check IS NULL
      THEN 'FAIL ← policy has neither USING nor WITH CHECK'
    ELSE 'PASS'
  END AS status
FROM deny_policies d
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
  AND p.tablename = d.tbl
  AND p.policyname = d.pol
ORDER BY d.tbl, d.pol;

-- ── Section 12: Critical CHECK constraints ────────────────────────────────
--
-- signals.type and events.status drive trust score calculation and product
-- logic respectively. If these constraints were dropped or altered, invalid
-- values could silently corrupt trust scores (wrong counts) or allow unknown
-- event states to enter the feed.

WITH expected_checks AS (
  SELECT * FROM (VALUES
    ('signals', 'signals_type_check',       'signals.type IN (confirm, dispute)'),
    ('events',  'events_status_check',      'events.status IN (emerging, developing, verified, disputed)'),
    ('events',  'events_trust_score_check', 'events.trust_score BETWEEN 0 AND 100')
  ) AS t(tbl, expected_name, description)
)
SELECT
  e.tbl         AS "table",
  e.description AS "expected_constraint",
  CASE
    WHEN c.conname IS NOT NULL THEN 'PASS — ' || c.conname
    -- Fall back: look for any CHECK constraint on the table that covers the column
    ELSE 'FAIL ← no matching CHECK constraint found (run Section 2 to inspect)'
  END AS status
FROM expected_checks e
-- Try to find a CHECK constraint whose definition contains the key column name
LEFT JOIN pg_constraint c
  ON c.conrelid = ('public.' || e.tbl)::regclass
  AND c.contype = 'c'
  AND (
    -- signals.type check
    (e.tbl = 'signals'  AND pg_get_constraintdef(c.oid) LIKE '%confirm%' AND pg_get_constraintdef(c.oid) LIKE '%dispute%')
    OR
    -- events.status check
    (e.tbl = 'events' AND pg_get_constraintdef(c.oid) LIKE '%emerging%')
    OR
    -- events.trust_score check
    (e.tbl = 'events' AND pg_get_constraintdef(c.oid) LIKE '%trust_score%')
  )
ORDER BY e.tbl, e.description;

-- ── Section 13: Trigger timing and event coverage ────────────────────────
--
-- Section 5 verifies triggers are ENABLED. This section verifies their
-- timing (BEFORE vs AFTER) and which DML events they cover.
--
-- pg_trigger.tgtype bitmask (PostgreSQL trigger.h):
--   ROW=1  BEFORE=2  INSERT=4  DELETE=8  UPDATE=16  TRUNCATE=32
--
-- Expected tgtype values:
--   signals_enforce_immutable_fields:  BEFORE(2) | ROW(1) | UPDATE(16)  = 19
--   signals_sync_trust_score:          AFTER(0)  | ROW(1) | INSERT(4) | DELETE(8) | UPDATE(16) = 29
--   trg_sync_source_count:             AFTER(0)  | ROW(1) | INSERT(4) | DELETE(8) = 13

WITH expected_triggers AS (
  SELECT * FROM (VALUES
    ('signals',       'signals_enforce_immutable_fields', 19,
     'BEFORE UPDATE — must be BEFORE or the immutability check runs too late'),
    ('signals',       'signals_sync_trust_score',         29,
     'AFTER INSERT OR UPDATE OR DELETE — must cover DELETE for user account cascade'),
    ('event_updates', 'trg_sync_source_count',            13,
     'AFTER INSERT OR DELETE')
  ) AS t(tbl, trig, expected_tgtype, description)
)
SELECT
  e.tbl          AS "table",
  e.trig         AS "trigger",
  e.description  AS "expected",
  t.tgtype       AS "actual_tgtype",
  CASE
    WHEN t.tgname IS NULL
      THEN 'FAIL ← trigger not found (check Section 5)'
    WHEN t.tgtype <> e.expected_tgtype
      THEN 'FAIL ← tgtype ' || t.tgtype || ' ≠ expected ' || e.expected_tgtype || ' (' || e.description || ')'
    ELSE 'PASS'
  END AS status
FROM expected_triggers e
LEFT JOIN pg_trigger t
  ON t.tgname = e.trig
  AND t.tgrelid = ('public.' || e.tbl)::regclass
ORDER BY e.tbl, e.trig;

-- ── Section 14: Functional index for dedup query ──────────────────────────
--
-- Migration 014 adds idx_events_dedup on (lower(title), created_at DESC).
-- If this index is missing, the ingest_event dedup query is a sequential scan.

SELECT
  CASE WHEN count(*) > 0
    THEN 'PASS — idx_events_dedup exists'
    ELSE 'FAIL ← idx_events_dedup missing (run migration 014)'
  END AS "dedup_index_status"
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'events'
  AND indexname  = 'idx_events_dedup';

-- ── Summary ───────────────────────────────────────────────────────────────
-- All rows should show 'PASS' after migrations 001–016 are applied.
-- Any 'FAIL' row indicates a configuration problem to investigate.
