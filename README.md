# IRIS

A real-time event tracking system that aggregates breaking events, tracks their evolution via updates, computes a dynamic trust score from user signals, and synchronizes all data in real time.

IRIS does not deliver news articles. Events are evolving entities with changing confidence levels — not static content.

---

## Table of Contents

1. [Product Definition](#1-product-definition)
2. [Data Model](#2-data-model)
3. [Database Logic](#3-database-logic)
4. [Security](#4-security)
5. [Backend Patterns](#5-backend-patterns)
6. [Frontend Architecture](#6-frontend-architecture)
7. [State Management](#7-state-management)
8. [Auth System](#8-auth-system)
9. [Data Fetching](#9-data-fetching)
10. [Realtime System](#10-realtime-system)
11. [Signal System](#11-signal-system)
12. [UI Structure](#12-ui-structure)
13. [Error Handling](#13-error-handling)
14. [Performance Decisions](#14-performance-decisions)
15. [Environment Config](#15-environment-config)
16. [TypeScript](#16-typescript)
17. [Setup](#17-setup)
18. [Current System State](#18-current-system-state)

---

## 1. Product Definition

IRIS performs the following functions:

- Displays a list of ongoing events (title, status, trust score)
- Tracks event evolution via chronological updates from different sources
- Computes a dynamic trust score based on user signals
- Enables users to confirm or dispute events (one signal per user per event)
- Synchronizes all data in real time across clients

**IRIS does not include:**
- Comments, replies, discussions, or reactions
- User-created events or updates
- Personalized feed or recommendation algorithm
- Editorial curation or moderation (MVP scope)
- Source weighting

---

## 2. Data Model

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID | References `auth.users` |
| email | TEXT | Nullable |
| created_at | TIMESTAMPTZ | |

### `events`
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| title | TEXT | |
| status | TEXT | CHECK: `emerging`, `developing`, `verified`, `disputed` |
| trust_score | INTEGER | Default 50, range 0–100 |
| source_count | INTEGER | Default 0, maintained by trigger |
| created_at | TIMESTAMPTZ | |

### `event_updates`
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| event_id | UUID | FK → `events.id` ON DELETE CASCADE |
| content | TEXT | |
| source_name | TEXT | |
| source_url | TEXT | Nullable |
| created_at | TIMESTAMPTZ | |

### `signals`
| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | FK → `auth.users.id` |
| event_id | UUID | FK → `events.id` |
| type | TEXT | `confirm` or `dispute` |
| created_at | TIMESTAMPTZ | |

**Constraint:** `UNIQUE(user_id, event_id)` — one signal per user per event.

---

## 3. Database Logic

### Trust Score (trigger-driven)

Implemented as a Postgres function `recalculate_trust_score(p_event_id UUID)` called automatically by the DB trigger `signals_sync_trust_score` (migration 006).

```sql
trust_score = ROUND(confirms / (confirms + disputes) * 100)
```

Rules:
- If total signals = 0 → reset to 50 (neutral default; handles the case where the last signal was deleted, e.g. via user account cascade)
- Score clamped 0–100 (belt-and-suspenders alongside the CHECK constraint on `events`)
- Trigger fires `AFTER INSERT OR UPDATE OR DELETE ON signals` → trust_score updated in the same transaction as the signal write — can never become stale silently, including when user accounts are deleted (cascade-deletes their signals)

**Why `SECURITY DEFINER`:** migration 004 added a RESTRICTIVE deny on `events UPDATE` for the `authenticated` role. Without `SECURITY DEFINER`, the function would run as the caller (authenticated user) and the UPDATE would be denied by RLS. With `SECURITY DEFINER` the function runs as its owner (postgres), which has BYPASSRLS. `SET search_path = public` is set on the function to prevent search-path injection (Supabase best practice).

### Source Count

Incremented automatically via DB trigger on INSERT into `event_updates`.

---

## 4. Security

### Row Level Security

| Table | Read | Write |
|---|---|---|
| `events` | Public | — (service role only via ingestion script) |
| `event_updates` | Public | — (service role only via ingestion script) |
| `signals` | Own rows only | INSERT + UPDATE own rows only (no DELETE — protected by RESTRICTIVE deny) |
| `users` | Own row only | — (created by trigger on auth.users INSERT) |

> **Security note:** RESTRICTIVE deny policies are ANDed with all permissive policies — no future accidental permissive policy can re-open a blocked path.
> - Migrations 004 + 005: block `authenticated` from INSERT/UPDATE/DELETE on `events`, `event_updates`, and `users`; block `authenticated` INSERT on `event_updates`
> - Migration 007: block `authenticated` DELETE on `signals`; add `WITH CHECK (auth.uid() = user_id)` to `signals_update_own` to prevent post-update ownership reassignment
> - Migration 009: BEFORE UPDATE trigger enforces signal field immutability (user_id, event_id, created_at); `recalculate_trust_score` and `ingest_event` REVOKED from PUBLIC; all SECURITY DEFINER functions use `SET search_path = public`
> - Migration 010: explicit `RESTRICTIVE FOR ALL TO anon USING (false)` on `signals` and `users` — the product rule "anonymous users do not enter the app" is now machine-verifiable via `pg_policies`
> - The ingestion script uses the service-role key which bypasses RLS entirely and is unaffected by any of the above.

---

## 5. Backend Patterns

### Signal Submission Flow

1. Client performs upsert on `signals`:
   ```sql
   ON CONFLICT (user_id, event_id)
   DO UPDATE SET type = EXCLUDED.type
   ```
2. DB trigger `signals_sync_trust_score` fires automatically → calls `recalculate_trust_score(event_id)` within the same transaction
3. DB updates `events.trust_score`
4. Realtime emits UPDATE → all subscribed clients update instantly

No client-side RPC call is needed. `trust_score` is always in sync with signals.

### Ingestion Duplicate Guard

Events are skipped if:
- Same title (exact match) exists
- Within the last 10 minutes

### Ingestion Script

- Location: `supabase/seed/ingest.ts`
- Uses service role key (server-only, never client)
- Inserts one event + one or more `event_updates` per call

---

## 6. Frontend Architecture

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native (Expo) |
| Language | TypeScript (strict mode) |
| Backend client | `@supabase/supabase-js` |
| Session storage | `expo-secure-store` (chunked adapter; disabled in Expo Go — see §15) |
| Navigation | `@react-navigation/native-stack` |

### Folder Structure

```
src/
├── components/
│   ├── ErrorBoundary.tsx    # Top-level crash recovery boundary
│   └── EventCard.tsx        # Card with vote buttons (signal state via props, no per-card fetch)
├── context/
│   └── AuthContext.tsx      # Single AuthProvider + useAuth — one subscription for the app
├── lib/
│   ├── formatRelativeTime.ts  # "just now" / "5m ago" / "3h ago" helper
│   └── supabase.ts          # Supabase client (env-var validated, chunked SecureStore)
├── hooks/
│   ├── useAuth.ts           # Re-export from AuthContext (no subscription)
│   ├── useEvents.ts         # Event list fetch + realtime (UPDATE + INSERT)
│   ├── useEventDetail.ts    # Event + updates fetch + realtime
│   ├── useUserSignal.ts     # Single-event signal fetch + upsert (EventDetailScreen)
│   └── useUserSignals.ts    # Bulk signal fetch for all events (EventListScreen, one query)
├── screens/
│   ├── SignInScreen.tsx
│   ├── EventListScreen.tsx
│   └── EventDetailScreen.tsx
├── services/
│   └── signalService.ts     # castSignal(userId, eventId, type) — upsert only (trigger handles score)
└── types/
    ├── index.ts             # DB types: Event, EventUpdate, Signal, User
    └── navigation.ts        # RootStackParamList

supabase/
├── migrations/
│   ├── 001_initial_schema.sql
│   ├── 002_recalculate_trust_score.sql
│   ├── 003_fix_source_count_trigger.sql
│   ├── 004_explicit_deny_policies.sql
│   ├── 005_deny_event_updates_insert.sql
│   ├── 006_signals_trust_score_trigger.sql
│   ├── 007_signal_integrity.sql
│   ├── 008_source_count_trigger_hardening.sql
│   ├── 009_backend_hardening.sql
│   ├── 010_explicit_anon_deny.sql
│   ├── 011_atomic_ingest_function.sql
│   ├── 012_ingest_event_validation.sql
│   ├── 013_trust_score_on_signal_delete.sql
│   ├── 014_case_insensitive_dedup.sql
│   └── 015_reconciliation_functions.sql
├── scripts/
│   └── verify_db.sql              # Read-only schema verification (run after applying all migrations)
└── seed/
    └── ingest.ts                  # Event ingestion script (calls ingest_event RPC, service-role only)
```

---

## 7. State Management

- No global state library
- All data managed via custom hooks
- Supabase is the single source of truth
- React local state only (`useState`, `useEffect`)

---

## 8. Auth System

### `AuthProvider` + `useAuth`

Auth state lives in a single `AuthContext` (`src/context/AuthContext.tsx`).

- `AuthProvider` wraps the entire app in `App.tsx` — creates **one** `getSession()` call and **one** `onAuthStateChange` subscription for the app's entire lifetime
- `useAuth()` is a thin context consumer — calling it in any screen does **not** create additional subscriptions
- Returns `{ userId: string | null, loading: boolean }`
- `loading: true` until session is resolved — prevents auth flicker

### App-level Auth Gate (`App.tsx`)

Three-state conditional render:

| State | Renders |
|---|---|
| `loading === true` | `ActivityIndicator` spinner |
| `userId === null` | `SignInScreen` (outside navigator) |
| `userId` set | `NavigationContainer` + stack |

### Sign In / Sign Up

- Email + password via `supabase.auth.signInWithPassword` and `supabase.auth.signUp`
- Separate **Sign In** and **Sign Up** buttons on the same form
- Inline validation: non-empty fields, password ≥ 6 characters
- Sign Up flow: confirmation email sent → "Check your email" screen → back to sign in
- UI states: form → per-button loading spinner → error inline / confirmation screen

### Sign Out

- Header button on Event List screen
- Calls `supabase.auth.signOut()`
- `onAuthStateChange` fires → `userId` becomes null → app returns to `SignInScreen`

---

## 9. Data Fetching

### `useEvents`

- Fetches all events, ordered `created_at DESC`
- Exposes: `{ events, loading, refreshing, error, refetch }`
- `loading` is `true` only on the initial fetch (shows full-screen spinner)
- `refreshing` is `true` on pull-to-refresh (FlatList native spinner)
- Realtime channel `events-feed` updates cards live on `events` UPDATE
- Error messages sanitized (raw DB errors never shown to user)

### `useEventDetail`

- Fetches event + updates in parallel via `Promise.all`
- Updates ordered `created_at ASC` (chronological timeline)
- Exposes: `{ event, updates, loading, error, refetch }`
- Also manages realtime subscriptions (see §10)

### `useUserSignals`

- Fetches all signals for the current user in **one** query: `select event_id, type from signals where user_id = {userId}`
- Returns `{ signalMap: Map<eventId, SignalType>, setSignal }`
- Used by `EventListScreen` to seed each `EventCard` with its initial signal state — eliminates N+1 per-card queries
- `setSignal(eventId, type)` keeps the map current after a submit, so a card that scrolls off and remounts receives the correct initial value

---

## 10. Realtime System

### Event List — `useEvents` channel

```
event: 'UPDATE', table: 'events'   (no filter — all events)
event: 'INSERT', table: 'events'   (no filter — prepends new events, deduplicated by id)
```
Channel name: `events-feed`. When any event's `trust_score` or `status` changes the matching card updates instantly. New events inserted by the ingestion script appear at the top without a pull-to-refresh.

### Event Detail — `useEventDetail` channels

Two subscriptions, both scoped to a single `eventId`.

**Channel `event-{id}`**
```
event: 'UPDATE', table: 'events', filter: id=eq.{eventId}
```
Patches the local `event` state (primarily `trust_score`).

**Channel `event-updates-{id}`**
```
event: 'INSERT', table: 'event_updates', filter: event_id=eq.{eventId}
```
Appends new timeline entries. **Deduplicated by `id`** — ignores entries already present (guards against refetch/subscription overlap).

### Cleanup

All channels removed via `supabase.removeChannel()` on component unmount.

### Trust Score Update Path

Signal submitted → `castSignal` upserts signal → DB trigger `signals_sync_trust_score` fires → `recalculate_trust_score` updates `events.trust_score` atomically → Realtime UPDATE fires → both list card and detail header patch automatically. No manual refetch needed, no client-side RPC call.

---

## 11. Signal System

### `signalService.castSignal(userId, eventId, type)`

Low-level service function. Performs one operation:
1. Upsert into `signals` with `onConflict: 'user_id,event_id'` (allows vote changes)

Throws on upsert failure. Trust score is recalculated automatically by the DB trigger — no explicit RPC call needed or made.

### `useUserSignals(userId)` — list screen bulk fetch

Fetches all signals for the current user in a single query. Returns a `Map<eventId, SignalType>` plus a `setSignal` updater. Used by `EventListScreen` to pass initial signal state to each card (one query total, not one per card).

### `useUserSignal(eventId, userId)` — detail screen single fetch

Returns `{ currentSignal, submitting, error, submitSignal }`.

**On mount:** fetches existing signal from DB via `.maybeSingle()`.
Used only by `EventDetailScreen` (single-event context).

**On `submitSignal(type)`:**

1. Guard: `if (type === currentSignal) return` — prevents no-op DB call
2. Optimistic update: `setCurrentSignal(type)`
3. Calls `castSignal(userId, eventId, type)`
4. On error: reverts optimistic update, sets sanitized error message
5. Realtime picks up the resulting `trust_score` change automatically

**Guards:**
- `submitting` flag blocks concurrent submissions
- No-op check blocks redundant DB call when same type re-tapped

---

## 12. UI Structure

### Event List Screen

| State | Renders |
|---|---|
| Loading | `ActivityIndicator` |
| Error | Message + Retry button |
| Empty | "No events yet." |
| Data | `FlatList` of event rows |

Each card: title, colored status badge, trust score bar, Confirm/Dispute buttons.  
Vote state seeded from `useUserSignals` bulk fetch (one query for all cards); selected button fills solid, other fades.  
Pull-to-refresh supported. Header: Sign Out button.

### Event Detail Screen

| State | Renders |
|---|---|
| Loading | `ActivityIndicator` |
| Error | Message + Retry button |
| Data | Header + timeline list |

Header: title, status, trust score, signal section.  
Timeline: source name, content, formatted timestamp (invalid date → `—`).

### Signal Section

Shown in the `EventDetailScreen` header. The screen is only reachable when authenticated (App.tsx auth gate), so `SignalSection` always renders the signed-in state:

Confirm + Dispute buttons side by side. Active button: filled background. Both disabled while `submitting`. Inline error shown below buttons on failure.

---

## 13. Error Handling

- Raw DB / Supabase error messages are never shown to users
- User-facing messages: `"Unable to load events"`, `"Unable to load event"`, `"Could not save signal. Please try again."`
- All raw errors logged via `console.error` with a `[hook-name]` prefix for tracing
- Signal submission failure reverts the optimistic update and shows the user-facing error message

---

## 14. Performance Decisions

- No refetch after signal submission — realtime is the sync mechanism
- `Promise.all` for parallel event + updates fetch
- No global state library — no unnecessary re-renders from unrelated state
- Queries are minimal (no overfetching — `select('*')` on small tables only)
- Realtime channels scoped per event — no broadcast to unrelated screens
- `useUserSignals` fetches all user signals in one query instead of one per card (eliminates N+1 on the list screen)

---

## 15. Environment Config

### Client (mobile app)
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### Server-only (ingestion script)
```
SUPABASE_SERVICE_KEY=your-service-role-key-here
```

> `SUPABASE_SERVICE_KEY` bypasses RLS. Never expose it in the mobile app or commit it to git.

Copy `.env.example` to `.env` and fill in values from:  
Supabase Dashboard → Project Settings → API

---

## 16. TypeScript

- `strict: true` enabled in `tsconfig.json`
- `noUncheckedIndexedAccess` not enabled
- Types aligned directly with DB schema (no ORM layer)
- `EventStatus` and `SignalType` are string union types (not enums)

---

## 17. Setup

**1. Install dependencies**
```bash
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
# Fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
```

**3. Apply database migrations** (Supabase SQL Editor, in order)
```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_recalculate_trust_score.sql
supabase/migrations/003_fix_source_count_trigger.sql
supabase/migrations/004_explicit_deny_policies.sql
supabase/migrations/005_deny_event_updates_insert.sql
supabase/migrations/006_signals_trust_score_trigger.sql
supabase/migrations/007_signal_integrity.sql
supabase/migrations/008_source_count_trigger_hardening.sql
supabase/migrations/009_backend_hardening.sql
supabase/migrations/010_explicit_anon_deny.sql
supabase/migrations/011_atomic_ingest_function.sql
supabase/migrations/012_ingest_event_validation.sql
supabase/migrations/013_trust_score_on_signal_delete.sql
supabase/migrations/014_case_insensitive_dedup.sql
supabase/migrations/015_reconciliation_functions.sql
```

**4a. Verify schema** (optional — confirms all migrations applied correctly)
```sql
-- Run supabase/scripts/verify_db.sql in the SQL Editor.
-- All rows should show 'PASS'.
```

**5. Enable Realtime** in Supabase Dashboard → Database → Replication:
- Enable for `events` table
- Enable for `event_updates` table

**6. Seed data (optional)**
```bash
# Add SUPABASE_SERVICE_KEY to .env first
npx tsx supabase/seed/ingest.ts
```

**7. Start the app**
```bash
npx expo start
```

---

## 18. Current System State

### Implemented

- Event feed (list + detail) with full dark UI design system
- EventCard: status badge (color per status), trust score bar, source count, relative timestamp, Confirm/Dispute buttons
- Status filter tab bar on event list (All / Emerging / Developing / Verified / Disputed) — client-side, no extra fetch
- Pull-to-refresh on both event list and event detail screens
- Timeline updates (chronological, per event) with tappable source URLs (opens in browser)
- Dynamic navigation header title on EventDetail (shows event title once loaded)
- Source count displayed on both EventCard and EventDetail header
- User signaling (confirm / dispute) on both list cards and detail screen
  - List: vote state seeded from bulk fetch (`useUserSignals`) — one query for all cards
  - Detail: per-event fetch via `useUserSignal`
  - Optimistic update with revert on failure; state persists across navigation
- Trust score calculation (server-side Postgres trigger + SECURITY DEFINER function — atomic, always in sync)
- Realtime synchronization:
  - List screen: `events-feed` channel handles both UPDATE (trust score, status) and INSERT (new events, prepended + deduplicated)
  - Detail screen: two channels for event UPDATE + event_updates INSERT (deduped by id)
- Authentication (email + password via `signInWithPassword` / `signUp`)
  - Email regex validation before Supabase call
  - Sign Out button accessible from both EventList and EventDetail headers
- Error boundary wrapping the full navigation stack (crash recovery screen)
- `formatRelativeTime` helper: "just now" / "5m ago" / "3h ago" / "2d ago"
- Ingestion script (`npx tsx supabase/seed/ingest.ts`) calls `ingest_event` RPC (migrations 011–014): advisory-lock case-insensitive duplicate guard (TOCTOU-safe); event + updates in one transaction (no orphaned rows); input validation rejects empty title, empty updates array, missing update fields, invalid status; functional index on `lower(title)` supports O(log n) dedup query
- Production hardening: sanitized errors, realtime payload type guards, realtime dedup, signal no-op guard, isMounted guard, SecureStore chunk write-order fix
- Admin reconciliation functions (migration 015): `reconcile_source_counts()` and `reconcile_trust_scores()` repair denormalized counters after any out-of-band data operations; service_role only, SECURITY DEFINER
- Unified trust score formula (migration 016): `compute_trust_score(confirms, disputes)` is the single authoritative scoring function (IMMUTABLE SQL); both `recalculate_trust_score` and `reconcile_trust_scores` delegate to it — formula lives in one place, drift between trigger path and reconciliation tool is structurally impossible
- Security:
  - RESTRICTIVE deny policies on all write paths for `authenticated` (migrations 004, 005, 007): events INSERT/UPDATE/DELETE, event_updates INSERT/UPDATE/DELETE, users INSERT/UPDATE/DELETE, signals DELETE
  - Explicit RESTRICTIVE deny for `anon` role on signals and users (migration 010): product rule machine-verifiable via pg_policies
  - `signals_update_own` WITH CHECK prevents post-update user_id/event_id reassignment (migration 007)
  - BEFORE UPDATE trigger enforces signal field immutability: user_id, event_id, created_at cannot be changed after creation (migration 009)
  - Trust score trigger is SECURITY DEFINER + SET search_path=public; SELECT FOR UPDATE serializes concurrent recomputations; fires on INSERT OR UPDATE OR DELETE — covers user account cascade-delete path (migrations 006, 009, 013)
  - `recalculate_trust_score`, `ingest_event`, `reconcile_source_counts`, `reconcile_trust_scores`, `compute_trust_score` all REVOKED from PUBLIC, GRANT to service_role only (migrations 009, 011–016)
  - All SECURITY DEFINER functions have SET search_path=public (migrations 006, 008, 009, 011–016)
  - Source_count trigger hardened to SECURITY DEFINER; dead function `increment_source_count` removed (migration 008)
- Schema verification script: `supabase/scripts/verify_db.sql` — read-only SQL verifying RLS, RESTRICTIVE policy expressions, SECURITY DEFINER functions, trigger timing/events, EXECUTE grants, CHECK constraints, and functional indexes (001–016)

### Not Implemented

- Session persistence across restarts (disabled for Expo Go; re-enable SecureStoreAdapter + `persistSession: true` in `supabase.ts` for production EAS builds)
- Offline / no-connection indicator
- Push notifications
- Rate limiting / abuse protection
- Advanced ingestion (AI-assisted, fuzzy dedup)
- Reputation or source weighting
- Automated moderation
- Analytics
