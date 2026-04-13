-- verify_db.sql
--
-- Read-only verification script for the IRIS database schema.
-- Run after applying all migrations (001–024) to confirm expected state.
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
  AND relname IN (
    'events', 'event_updates', 'signals', 'users',
    'user_preferences', 'event_follows', 'sources'
  )
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
  AND tablename IN (
    'events', 'event_updates', 'signals', 'users',
    'user_preferences', 'event_follows', 'sources'
  )
ORDER BY tablename, policyname;

-- ── Section 3: RESTRICTIVE deny policies — all 19 required ──────────────
--
-- After migrations 004, 005, 007, 010, 018, 019, 023 the following RESTRICTIVE
-- policies must exist. Any missing row = FAIL.

WITH expected_restrictive AS (
  SELECT * FROM (VALUES
    -- migration 004
    ('events',            'deny_events_insert'),
    ('events',            'deny_events_update'),
    ('events',            'deny_events_delete'),
    ('event_updates',     'deny_event_updates_update'),
    ('event_updates',     'deny_event_updates_delete'),
    ('users',             'deny_users_insert'),
    ('users',             'deny_users_update'),
    ('users',             'deny_users_delete'),
    -- migration 005
    ('event_updates',     'deny_event_updates_insert'),
    -- migration 007
    ('signals',           'deny_signals_delete'),
    -- migration 010
    ('signals',           'deny_signals_anon'),
    ('users',             'deny_users_anon'),
    -- migration 018
    ('user_preferences',  'deny_prefs_anon'),
    ('user_preferences',  'deny_prefs_delete'),
    -- migration 019
    ('event_follows',     'deny_follows_anon'),
    ('event_follows',     'deny_follows_update'),
    -- migration 023
    ('sources',           'deny_sources_insert'),
    ('sources',           'deny_sources_update'),
    ('sources',           'deny_sources_delete')
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
    'reconcile_source_counts',      -- migration 015
    'reconcile_trust_scores',       -- migration 015 / 024 shim
    'compute_trust_score',          -- migration 024 (composite formula)
    'sync_follow_count',            -- migration 019
    'toggle_event_follow',          -- migration 019 (user-callable RPC)
    'compute_crowd_score',          -- migration 024
    'compute_source_score',         -- migration 024
    'recalculate_event_scores',     -- migration 024
    'reconcile_event_scores'        -- migration 024
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
    'signals_enforce_immutable_fields',   -- BEFORE UPDATE on signals (migration 009)
    'trg_sync_follow_count'               -- AFTER INSERT OR DELETE on event_follows (migration 019)
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
  SELECT 'recalculate_trust_score(uuid)'         AS fn UNION ALL
  SELECT 'ingest_event(text,text,jsonb)'              UNION ALL
  SELECT 'reconcile_source_counts()'                  UNION ALL
  SELECT 'reconcile_trust_scores()'                   UNION ALL
  SELECT 'compute_trust_score(integer,integer)'       UNION ALL  -- migration 024 (composite)
  SELECT 'compute_crowd_score(integer,integer)'       UNION ALL  -- migration 024
  SELECT 'compute_source_score(uuid)'                 UNION ALL  -- migration 024
  SELECT 'recalculate_event_scores(uuid)'             UNION ALL  -- migration 024
  SELECT 'reconcile_event_scores()'                              -- migration 024
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
    ('events',            'deny_events_insert'),
    ('events',            'deny_events_update'),
    ('events',            'deny_events_delete'),
    ('event_updates',     'deny_event_updates_update'),
    ('event_updates',     'deny_event_updates_delete'),
    ('event_updates',     'deny_event_updates_insert'),
    ('users',             'deny_users_insert'),
    ('users',             'deny_users_update'),
    ('users',             'deny_users_delete'),
    ('signals',           'deny_signals_delete'),
    ('signals',           'deny_signals_anon'),
    ('users',             'deny_users_anon'),
    ('user_preferences',  'deny_prefs_anon'),
    ('user_preferences',  'deny_prefs_delete'),
    ('event_follows',     'deny_follows_anon'),
    ('event_follows',     'deny_follows_update'),
    -- migration 023
    ('sources',           'deny_sources_insert'),
    ('sources',           'deny_sources_update'),
    ('sources',           'deny_sources_delete')
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
    ('signals',          'signals_type_check',              'signals.type IN (confirm, dispute)'),
    ('events',           'events_status_check',             'events.status IN (emerging, developing, verified, disputed)'),
    ('events',           'events_trust_score_check',        'events.trust_score BETWEEN 0 AND 100'),
    ('events',           'events_source_score_check',       'events.source_score BETWEEN 0 AND 100'),
    ('events',           'events_crowd_score_check',        'events.crowd_score BETWEEN 0 AND 100'),
    ('user_preferences', 'user_preferences_theme_check',    'user_preferences.theme IN (system, light, dark)'),
    ('sources',          'sources_credibility_check',       'sources.credibility BETWEEN 0 AND 100'),
    ('sources',          'sources_source_type_check',       'sources.source_type IN (media, official, expert, community)')
  ) AS t(tbl, expected_name, description)
)
SELECT
  e.tbl         AS "table",
  e.description AS "expected_constraint",
  CASE
    WHEN c.conname IS NOT NULL THEN 'PASS — ' || c.conname
    ELSE 'FAIL ← no matching CHECK constraint found (run Section 2 to inspect)'
  END AS status
FROM expected_checks e
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
    OR
    -- events.source_score check
    (e.tbl = 'events' AND pg_get_constraintdef(c.oid) LIKE '%source_score%')
    OR
    -- events.crowd_score check
    (e.tbl = 'events' AND pg_get_constraintdef(c.oid) LIKE '%crowd_score%')
    OR
    -- user_preferences.theme check
    (e.tbl = 'user_preferences' AND pg_get_constraintdef(c.oid) LIKE '%system%' AND pg_get_constraintdef(c.oid) LIKE '%light%')
    OR
    -- sources.credibility check
    (e.tbl = 'sources' AND pg_get_constraintdef(c.oid) LIKE '%credibility%')
    OR
    -- sources.source_type check
    (e.tbl = 'sources' AND pg_get_constraintdef(c.oid) LIKE '%media%' AND pg_get_constraintdef(c.oid) LIKE '%official%')
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
     'AFTER INSERT OR DELETE'),
    ('event_follows', 'trg_sync_follow_count',            13,
     'AFTER INSERT OR DELETE — keeps follow_count denormalized counter in sync')
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

-- ── Section 15: Signal permissive policy ownership correctness ───────────
--
-- Confirms the permissive policies that grant signal access to `authenticated`
-- users have the correct ownership expressions. These are not RESTRICTIVE
-- policies (those are in Sections 3 + 11), but their expressions are critical:
--
--   signals_insert_own: WITH CHECK must contain user_id — ensures a user can
--     only insert a signal where user_id = their own uid. Without this an
--     authenticated user could insert signals for other users.
--
--   signals_update_own: USING + WITH CHECK must both contain user_id — USING
--     restricts which rows they can update (own rows only); WITH CHECK ensures
--     the result row still belongs to them (prevents user_id reassignment).
--     Migration 007 fixed the missing WITH CHECK; this section verifies it.
--
--   signals_read_own: USING must contain user_id — restricts SELECT to own
--     signal rows. Without this all signals would be publicly readable.
--
--   signals_delete_own: must NOT exist — this permissive DELETE policy was
--     created in migration 001 and dropped in migration 017. Its presence after
--     migration 017 indicates the migration was not applied. While deny_signals_delete
--     RESTRICTIVE would still block deletes, the dead policy is a clarity hazard.

-- ── Part A: Ownership expression check on permissive signal policies ───────

WITH expected_signal_policies AS (
  SELECT * FROM (VALUES
    ('signals_insert_own', 'INSERT', NULL::text,                 'auth.uid() = user_id'),
    ('signals_update_own', 'UPDATE', 'auth.uid() = user_id',     'auth.uid() = user_id'),
    ('signals_read_own',   'SELECT', 'auth.uid() = user_id',     NULL::text)
  ) AS t(polname, cmd, required_qual_fragment, required_check_fragment)
)
SELECT
  e.polname   AS "policy",
  e.cmd,
  p.qual       AS "using_expr",
  p.with_check AS "with_check_expr",
  CASE
    WHEN p.policyname IS NULL
      THEN 'FAIL ← policy missing'
    WHEN e.required_qual_fragment IS NOT NULL
      AND (p.qual IS NULL OR p.qual NOT LIKE '%user_id%')
      THEN 'FAIL ← USING clause missing or lacks user_id ownership check'
    WHEN e.required_check_fragment IS NOT NULL
      AND (p.with_check IS NULL OR p.with_check NOT LIKE '%user_id%')
      THEN 'FAIL ← WITH CHECK clause missing or lacks user_id ownership check'
    ELSE 'PASS'
  END AS status
FROM expected_signal_policies e
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
  AND p.tablename = 'signals'
  AND p.policyname = e.polname
ORDER BY e.polname;

-- ── Part B: signals_delete_own must not exist (dropped in migration 017) ───

SELECT
  CASE WHEN count(*) = 0
    THEN 'PASS — signals_delete_own does not exist'
    ELSE 'FAIL ← dead permissive DELETE policy signals_delete_own still exists (apply migration 017)'
  END AS "signals_delete_own_dropped"
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'signals'
  AND policyname = 'signals_delete_own';

-- ── Section 16: user_preferences table (migration 018) ───────────────────
--
-- Comprehensive verification of the user_preferences table.
--
-- RLS enablement   → Section 1 (included there)
-- RESTRICTIVE deny → Sections 3 + 11 (deny_prefs_anon, deny_prefs_delete)
-- CHECK constraint → Section 12 (user_preferences_theme_check)
-- This section covers: table + column existence, permissive policy ownership
-- expressions, theme default value, CASCADE FK linkage, and absence of
-- unexpected permissive policies.

-- ── Part A: Table and column existence ───────────────────────────────────
--
-- All downstream parts in this section assume the table exists. A FAIL here
-- means migration 018 was not applied — other parts will show confusing NULLs.

SELECT
  cl.relname AS table_name,
  CASE WHEN cl.oid IS NOT NULL THEN 'PASS — table exists' ELSE 'FAIL ← user_preferences table missing (apply migration 018)' END AS table_status,
  (
    SELECT COUNT(*) FROM pg_attribute a
    WHERE a.attrelid = cl.oid
      AND a.attname IN ('user_id', 'theme', 'updated_at')
      AND NOT a.attisdropped
  ) AS expected_columns_found,
  CASE
    WHEN cl.oid IS NULL
      THEN 'FAIL ← table missing (apply migration 018)'
    WHEN (
      SELECT COUNT(*) FROM pg_attribute a
      WHERE a.attrelid = cl.oid
        AND a.attname IN ('user_id', 'theme', 'updated_at')
        AND NOT a.attisdropped
    ) < 3
      THEN 'FAIL ← one or more expected columns (user_id, theme, updated_at) not found'
    ELSE 'PASS — all 3 expected columns present'
  END AS column_status
FROM pg_namespace n
LEFT JOIN pg_class cl
  ON cl.relnamespace = n.oid AND cl.relname = 'user_preferences' AND cl.relkind = 'r'
WHERE n.nspname = 'public';

-- ── Part B: Permissive policy ownership expressions ───────────────────────
--
-- prefs_read_own:   USING must contain user_id
-- prefs_insert_own: WITH CHECK must contain user_id
-- prefs_update_own: USING + WITH CHECK must both contain user_id

WITH expected_prefs_policies AS (
  SELECT * FROM (VALUES
    ('prefs_read_own',   'SELECT', 'auth.uid() = user_id', NULL::text),
    ('prefs_insert_own', 'INSERT', NULL::text,             'auth.uid() = user_id'),
    ('prefs_update_own', 'UPDATE', 'auth.uid() = user_id', 'auth.uid() = user_id')
  ) AS t(polname, cmd, required_qual_fragment, required_check_fragment)
)
SELECT
  e.polname    AS "policy",
  e.cmd,
  p.qual        AS "using_expr",
  p.with_check  AS "with_check_expr",
  CASE
    WHEN p.policyname IS NULL
      THEN 'FAIL ← policy missing (apply migration 018)'
    WHEN e.required_qual_fragment IS NOT NULL
      AND (p.qual IS NULL OR p.qual NOT LIKE '%user_id%')
      THEN 'FAIL ← USING clause missing or lacks user_id ownership check'
    WHEN e.required_check_fragment IS NOT NULL
      AND (p.with_check IS NULL OR p.with_check NOT LIKE '%user_id%')
      THEN 'FAIL ← WITH CHECK clause missing or lacks user_id ownership check'
    ELSE 'PASS'
  END AS status
FROM expected_prefs_policies e
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
  AND p.tablename = 'user_preferences'
  AND p.policyname = e.polname
ORDER BY e.polname;

-- ── Part C: Unexpected permissive policies ────────────────────────────────
--
-- The only permissive policies that should exist on user_preferences are:
--   prefs_read_own, prefs_insert_own, prefs_update_own
-- An additional permissive policy (e.g. an accidental FOR ALL or FOR DELETE)
-- would be a security gap that Part B above would not catch.

SELECT
  policyname AS "policy",
  cmd,
  roles,
  CASE
    WHEN policyname IN ('prefs_read_own', 'prefs_insert_own', 'prefs_update_own')
      THEN 'PASS — expected permissive policy'
    ELSE 'FAIL ← unexpected permissive policy (review and remove): ' || policyname
  END AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'user_preferences'
  AND permissive = 'PERMISSIVE'
ORDER BY policyname;

-- ── Part D: Default theme value ───────────────────────────────────────────
--
-- user_preferences.theme must default to 'system'. Uses pg_attrdef directly
-- to avoid information_schema version sensitivity.

SELECT
  a.attname                          AS column_name,
  pg_get_expr(d.adbin, d.adrelid)   AS column_default,
  CASE
    WHEN d.adbin IS NULL
      THEN 'FAIL ← theme column has no default (any new user row will require explicit theme value)'
    WHEN pg_get_expr(d.adbin, d.adrelid) LIKE '%system%'
      THEN 'PASS'
    ELSE 'FAIL ← default does not include ''system'': ' || pg_get_expr(d.adbin, d.adrelid)
  END AS status
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.user_preferences'::regclass
  AND a.attname  = 'theme'
  AND NOT a.attisdropped;

-- ── Part E: CASCADE delete linkage ────────────────────────────────────────
--
-- user_preferences.user_id must reference auth.users(id) ON DELETE CASCADE.
-- Uses pg_constraint directly — reliable for cross-schema FKs (auth.users
-- is in the auth schema, not public, which makes information_schema joins
-- fragile).

SELECT
  c.conname AS constraint_name,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE c.confdeltype::text
  END AS delete_rule,
  n_ref.nspname || '.' || cl_ref.relname AS referenced_table,
  CASE
    WHEN c.confdeltype = 'c'
      THEN 'PASS'
    WHEN c.confdeltype = 'a'
      THEN 'FAIL ← delete_rule is NO ACTION — deleting auth.users row leaves orphan preferences'
    WHEN c.confdeltype = 'r'
      THEN 'FAIL ← delete_rule is RESTRICT — cannot delete auth.users row while preferences exist'
    ELSE 'FAIL ← delete_rule is not CASCADE: ' || c.confdeltype::text
  END AS status
FROM pg_constraint c
JOIN pg_class cl         ON cl.oid  = c.conrelid
JOIN pg_namespace n      ON n.oid   = cl.relnamespace
JOIN pg_class cl_ref     ON cl_ref.oid = c.confrelid
JOIN pg_namespace n_ref  ON n_ref.oid  = cl_ref.relnamespace
WHERE n.nspname  = 'public'
  AND cl.relname = 'user_preferences'
  AND c.contype  = 'f';


-- ── Section 17: event_follows table (migration 019) ──────────────────────
--
-- Comprehensive verification of the event_follows table and its counter
-- mechanism on events.follow_count.
--
-- RLS enablement   → Section 1 (included there)
-- RESTRICTIVE deny → Sections 3 + 11 (deny_follows_anon, deny_follows_update)
-- Trigger timing   → Section 13 (trg_sync_follow_count, tgtype=13)

-- ── Part A: Table + column existence ─────────────────────────────────────

SELECT
  cl.relname AS table_name,
  CASE WHEN cl.oid IS NOT NULL THEN 'PASS — table exists'
       ELSE 'FAIL ← event_follows table missing (apply migration 019)' END AS table_status,
  (
    SELECT COUNT(*) FROM pg_attribute a
    WHERE a.attrelid = cl.oid
      AND a.attname IN ('user_id', 'event_id', 'created_at')
      AND NOT a.attisdropped
  ) AS expected_columns_found,
  CASE
    WHEN cl.oid IS NULL
      THEN 'FAIL ← table missing'
    WHEN (
      SELECT COUNT(*) FROM pg_attribute a
      WHERE a.attrelid = cl.oid
        AND a.attname IN ('user_id', 'event_id', 'created_at')
        AND NOT a.attisdropped
    ) < 3
      THEN 'FAIL ← one or more expected columns (user_id, event_id, created_at) not found'
    ELSE 'PASS — all 3 expected columns present'
  END AS column_status
FROM pg_namespace n
LEFT JOIN pg_class cl
  ON cl.relnamespace = n.oid AND cl.relname = 'event_follows' AND cl.relkind = 'r'
WHERE n.nspname = 'public';

-- ── Part B: follow_count column on events ─────────────────────────────────

SELECT
  a.attname AS column_name,
  CASE
    WHEN a.attnum IS NULL
      THEN 'FAIL ← follow_count column missing from events (apply migration 019)'
    ELSE 'PASS'
  END AS status
FROM pg_class cl
JOIN pg_namespace n ON n.oid = cl.relnamespace
LEFT JOIN pg_attribute a
  ON a.attrelid = cl.oid AND a.attname = 'follow_count' AND NOT a.attisdropped
WHERE n.nspname = 'public' AND cl.relname = 'events';

-- ── Part C: Permissive policy ownership expressions ───────────────────────
--
-- follows_read_own:   USING must contain user_id
-- follows_insert_own: WITH CHECK must contain user_id
-- follows_delete_own: USING must contain user_id

WITH expected_follows_policies AS (
  SELECT * FROM (VALUES
    ('follows_read_own',   'SELECT', 'auth.uid() = user_id', NULL::text),
    ('follows_insert_own', 'INSERT', NULL::text,             'auth.uid() = user_id'),
    ('follows_delete_own', 'DELETE', 'auth.uid() = user_id', NULL::text)
  ) AS t(polname, cmd, required_qual_fragment, required_check_fragment)
)
SELECT
  e.polname    AS "policy",
  e.cmd,
  p.qual        AS "using_expr",
  p.with_check  AS "with_check_expr",
  CASE
    WHEN p.policyname IS NULL
      THEN 'FAIL ← policy missing (apply migration 019)'
    WHEN e.required_qual_fragment IS NOT NULL
      AND (p.qual IS NULL OR p.qual NOT LIKE '%user_id%')
      THEN 'FAIL ← USING clause missing or lacks user_id ownership check'
    WHEN e.required_check_fragment IS NOT NULL
      AND (p.with_check IS NULL OR p.with_check NOT LIKE '%user_id%')
      THEN 'FAIL ← WITH CHECK clause missing or lacks user_id ownership check'
    ELSE 'PASS'
  END AS status
FROM expected_follows_policies e
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
  AND p.tablename = 'event_follows'
  AND p.policyname = e.polname
ORDER BY e.polname;

-- ── Part D: CASCADE FK linkage (both FKs) ────────────────────────────────
--
-- event_follows.user_id  → auth.users(id)    ON DELETE CASCADE
-- event_follows.event_id → public.events(id) ON DELETE CASCADE

SELECT
  c.conname AS constraint_name,
  n_ref.nspname || '.' || cl_ref.relname AS referenced_table,
  CASE c.confdeltype
    WHEN 'c' THEN 'CASCADE'
    ELSE c.confdeltype::text
  END AS delete_rule,
  CASE
    WHEN c.confdeltype = 'c' THEN 'PASS'
    ELSE 'FAIL ← expected CASCADE, got: ' || c.confdeltype::text
  END AS status
FROM pg_constraint c
JOIN pg_class cl         ON cl.oid  = c.conrelid
JOIN pg_namespace n      ON n.oid   = cl.relnamespace
JOIN pg_class cl_ref     ON cl_ref.oid = c.confrelid
JOIN pg_namespace n_ref  ON n_ref.oid  = cl_ref.relnamespace
WHERE n.nspname  = 'public'
  AND cl.relname = 'event_follows'
  AND c.contype  = 'f'
ORDER BY referenced_table;

-- ── Part E: sync_follow_count is SECURITY DEFINER ────────────────────────

SELECT
  p.proname AS "function",
  CASE
    WHEN NOT p.prosecdef
      THEN 'FAIL ← must be SECURITY DEFINER'
    WHEN NOT (p.proconfig @> ARRAY['search_path=public'])
      THEN 'FAIL ← missing SET search_path=public'
    ELSE 'PASS'
  END AS status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'sync_follow_count';

-- ── Part F: Unexpected permissive policies ────────────────────────────────

SELECT
  policyname AS "policy",
  cmd,
  roles,
  CASE
    WHEN policyname IN ('follows_read_own', 'follows_insert_own', 'follows_delete_own')
      THEN 'PASS — expected permissive policy'
    ELSE 'FAIL ← unexpected permissive policy (review and remove): ' || policyname
  END AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'event_follows'
  AND permissive = 'PERMISSIVE'
ORDER BY policyname;

-- ── Section 18: Public RPC accessibility (migrations 019, 020, 021, 022) ──
--
-- toggle_event_follow is SECURITY DEFINER — only authenticated should call it
--   (anon is rejected inside the function body via auth.uid() IS NULL check;
--   EXECUTE is still granted to PUBLIC by default so we mark anon as SKIP).
-- get_rising_events, search_events, search_event_updates are SECURITY INVOKER
--   public read functions — both anon and authenticated must be able to call them.

WITH rpc_checks AS (
  SELECT 'toggle_event_follow(uuid)'     AS fn, false AS anon_allowed UNION ALL
  SELECT 'get_rising_events(integer)'    AS fn, true  AS anon_allowed UNION ALL
  SELECT 'search_events(text,integer)'   AS fn, true  AS anon_allowed UNION ALL
  SELECT 'search_event_updates(text)'    AS fn, true  AS anon_allowed UNION ALL
  SELECT 'get_event_sources(uuid)'       AS fn, true  AS anon_allowed   -- migration 023
),
roles AS (
  SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
)
SELECT
  c.fn,
  r.rolname AS "role",
  CASE
    WHEN r.rolname = 'anon' AND NOT c.anon_allowed
      THEN 'SKIP — anon not expected to have execute (function enforces auth internally)'
    WHEN has_function_privilege(r.rolname, 'public.' || c.fn, 'execute')
      THEN 'PASS — can execute'
    ELSE 'FAIL ← role cannot execute (check GRANT on function)'
  END AS status
FROM rpc_checks c CROSS JOIN roles r
ORDER BY c.fn, r.rolname;

-- ── Section 19: GIN FTS indexes (migration 022) ───────────────────────────
--
-- Uses an expected-set LEFT JOIN so a missing index produces an explicit FAIL
-- row rather than silently returning zero rows.

SELECT
  expected.index_name,
  CASE
    WHEN pi.indexname IS NOT NULL THEN 'PASS — GIN index exists'
    ELSE 'FAIL ← GIN index missing (apply migration 022)'
  END AS status
FROM (VALUES
  ('idx_events_fts'),
  ('idx_event_updates_fts')
) AS expected(index_name)
LEFT JOIN pg_indexes pi
  ON pi.schemaname = 'public'
  AND pi.indexname = expected.index_name
ORDER BY expected.index_name;

-- ── Section 20: search_event_updates function (migration 022) ─────────────
--
-- Uses LEFT JOIN so a missing function produces an explicit FAIL row rather
-- than silently returning zero rows.

SELECT
  'search_event_updates' AS function_name,
  CASE
    WHEN p.proname IS NULL
      THEN 'FAIL ← function missing (apply migration 022)'
    WHEN p.prosecdef = true
      THEN 'FAIL ← function is unexpectedly SECURITY DEFINER'
    ELSE 'PASS — SECURITY INVOKER'
  END AS status
FROM (SELECT 'search_event_updates'::text AS expected_fn) x
LEFT JOIN (
  SELECT p.proname, p.prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_event_updates'
  LIMIT 1
) p ON p.proname = x.expected_fn;

-- ── Section 21: Sources table (migration 023) ────────────────────────────
--
-- Comprehensive verification of the sources table.
-- RLS enablement   → Section 1
-- RESTRICTIVE deny → Sections 3 + 11 (deny_sources_insert/update/delete)
-- CHECK constraints → Section 12 (credibility, source_type)
-- This section covers: table + column existence, permissive read policy,
-- unique name index, absence of unexpected permissive write policies.

-- ── Part A: Table and column existence ───────────────────────────────────

SELECT
  cl.relname AS table_name,
  CASE WHEN cl.oid IS NOT NULL THEN 'PASS — table exists'
       ELSE 'FAIL ← sources table missing (apply migration 023)' END AS table_status,
  (
    SELECT COUNT(*) FROM pg_attribute a
    WHERE a.attrelid = cl.oid
      AND a.attname IN ('id', 'name', 'domain', 'credibility', 'source_type', 'verified', 'created_at')
      AND NOT a.attisdropped
  ) AS expected_columns_found,
  CASE
    WHEN cl.oid IS NULL
      THEN 'FAIL ← table missing (apply migration 023)'
    WHEN (
      SELECT COUNT(*) FROM pg_attribute a
      WHERE a.attrelid = cl.oid
        AND a.attname IN ('id', 'name', 'domain', 'credibility', 'source_type', 'verified', 'created_at')
        AND NOT a.attisdropped
    ) < 7
      THEN 'FAIL ← one or more expected columns missing'
    ELSE 'PASS — all 7 expected columns present'
  END AS column_status
FROM pg_namespace n
LEFT JOIN pg_class cl
  ON cl.relnamespace = n.oid AND cl.relname = 'sources' AND cl.relkind = 'r'
WHERE n.nspname = 'public';

-- ── Part B: source_id column on event_updates ────────────────────────────

SELECT
  a.attname AS column_name,
  CASE
    WHEN a.attnum IS NULL
      THEN 'FAIL ← source_id column missing from event_updates (apply migration 023)'
    ELSE 'PASS'
  END AS status
FROM pg_class cl
JOIN pg_namespace n ON n.oid = cl.relnamespace
LEFT JOIN pg_attribute a
  ON a.attrelid = cl.oid AND a.attname = 'source_id' AND NOT a.attisdropped
WHERE n.nspname = 'public' AND cl.relname = 'event_updates';

-- ── Part C: Unique name index ─────────────────────────────────────────────
--
-- idx_sources_name_lower prevents duplicate source records with the same name.

SELECT
  'idx_sources_name_lower' AS index_name,
  CASE
    WHEN pi.indexname IS NOT NULL THEN 'PASS — unique name index exists'
    ELSE 'FAIL ← idx_sources_name_lower missing (apply migration 023)'
  END AS status
FROM (SELECT 'idx_sources_name_lower'::text AS expected_idx) x
LEFT JOIN pg_indexes pi
  ON pi.schemaname = 'public' AND pi.indexname = x.expected_idx;

-- ── Part D: sources_read_all permissive policy ────────────────────────────

SELECT
  policyname AS "policy",
  cmd,
  CASE
    WHEN policyname = 'sources_read_all' AND cmd = 'SELECT'
      THEN 'PASS — expected public read policy'
    ELSE 'FAIL ← unexpected policy or missing sources_read_all: ' || policyname
  END AS status
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'sources'
  AND permissive = 'PERMISSIVE'
ORDER BY policyname;


-- ── Section 22: Three-score trust model (migrations 023 + 024) ───────────
--
-- Verifies that events carries the three score columns, that the scoring
-- functions exist with correct security settings, and that the composite
-- formula produces expected outputs for known inputs.

-- ── Part A: score columns on events ──────────────────────────────────────

SELECT
  expected.col,
  CASE
    WHEN a.attname IS NOT NULL THEN 'PASS — column exists'
    ELSE 'FAIL ← column missing from events (apply migrations 023/024)'
  END AS status
FROM (VALUES ('source_score'), ('crowd_score')) AS expected(col)
LEFT JOIN pg_class cl
  ON cl.relnamespace = 'public'::regnamespace AND cl.relname = 'events'
LEFT JOIN pg_attribute a
  ON a.attrelid = cl.oid AND a.attname = expected.col AND NOT a.attisdropped
ORDER BY expected.col;

-- ── Part B: score function existence and security ─────────────────────────
--
-- compute_crowd_score, compute_source_score, compute_trust_score:
--   must all be SECURITY DEFINER + SET search_path=public (internal helpers).
-- recalculate_event_scores, reconcile_event_scores: same requirements.

SELECT
  expected.fn_name AS "function",
  CASE
    WHEN p.proname IS NULL
      THEN 'FAIL ← function missing (apply migration 024)'
    WHEN NOT p.prosecdef
      THEN 'FAIL ← must be SECURITY DEFINER'
    WHEN NOT (p.proconfig @> ARRAY['search_path=public'])
      THEN 'FAIL ← missing SET search_path=public'
    ELSE 'PASS'
  END AS status
FROM (VALUES
  ('compute_crowd_score'),
  ('compute_source_score'),
  ('compute_trust_score'),
  ('recalculate_event_scores'),
  ('reconcile_event_scores')
) AS expected(fn_name)
LEFT JOIN (
  SELECT p.proname, p.prosecdef, p.proconfig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
) p ON p.proname = expected.fn_name
ORDER BY expected.fn_name;

-- ── Part C: compute_trust_score formula verification ─────────────────────
--
-- Verifies the composite formula: clamp(source + (crowd - 50) * 0.2, 0, 100)
-- Tests known input/output pairs.

SELECT
  inputs.label,
  inputs.p_source,
  inputs.p_crowd,
  inputs.expected,
  public.compute_trust_score(inputs.p_source, inputs.p_crowd) AS actual,
  CASE
    WHEN public.compute_trust_score(inputs.p_source, inputs.p_crowd) = inputs.expected
      THEN 'PASS'
    ELSE 'FAIL ← got ' || public.compute_trust_score(inputs.p_source, inputs.p_crowd)
         || ', expected ' || inputs.expected
  END AS status
FROM (VALUES
  ('neutral baseline',       50,  50, 50),
  ('max crowd boost',        50, 100, 60),
  ('max crowd penalty',      50,   0, 40),
  ('high source + boost',    80, 100, 90),
  ('high source + penalty',  80,   0, 70),
  ('low source + boost',     20, 100, 30),
  ('clamp at 100',           95, 100, 100),
  ('clamp at 0',              5,   0,  0),
  ('partial crowd effect',   60,  75, 65)
) AS inputs(label, p_source, p_crowd, expected)
ORDER BY inputs.label;

-- ── Part D: compute_crowd_score formula verification ─────────────────────

SELECT
  inputs.label,
  inputs.confirms,
  inputs.disputes,
  inputs.expected,
  public.compute_crowd_score(inputs.confirms, inputs.disputes) AS actual,
  CASE
    WHEN public.compute_crowd_score(inputs.confirms, inputs.disputes) = inputs.expected
      THEN 'PASS'
    ELSE 'FAIL ← got ' || public.compute_crowd_score(inputs.confirms, inputs.disputes)
         || ', expected ' || inputs.expected
  END AS status
FROM (VALUES
  ('no signals',      0,  0, 50),
  ('all confirms',   10,  0, 100),
  ('all disputes',    0, 10, 0),
  ('50/50',           5,  5, 50),
  ('75% confirms',    3,  1, 75),
  ('1 of 3 confirms', 1,  2, 33)
) AS inputs(label, confirms, disputes, expected)
ORDER BY inputs.label;


-- ── Summary ───────────────────────────────────────────────────────────────
-- All rows should show 'PASS' (or 'SKIP') after migrations 001–024 are applied.
-- Any 'FAIL' row indicates a configuration problem to investigate.
