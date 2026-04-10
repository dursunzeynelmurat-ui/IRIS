-- verify_db.sql
--
-- Read-only verification script for the IRIS database schema.
-- Run after applying all migrations (001–011) to confirm expected state.
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
    'ingest_event'
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
    'signals_sync_trust_score',           -- AFTER INSERT OR UPDATE on signals (migration 006)
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
-- recalculate_trust_score and ingest_event must NOT be callable by
-- anon or authenticated; service_role must be able to call both.

WITH checks AS (
  SELECT 'recalculate_trust_score(uuid)' AS fn UNION ALL
  SELECT 'ingest_event(text,text,jsonb)'
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

-- ── Summary ───────────────────────────────────────────────────────────────
-- All rows should show 'PASS' after migrations 001–011 are applied.
-- Any 'FAIL' row indicates a configuration problem to investigate.
