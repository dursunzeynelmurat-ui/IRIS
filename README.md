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
12. [User Preferences](#12-user-preferences)
13. [UI Structure](#13-ui-structure)
14. [Error Handling](#14-error-handling)
15. [Performance Decisions](#15-performance-decisions)
16. [Environment Config](#16-environment-config)
17. [TypeScript](#17-typescript)
18. [Setup](#18-setup)
19. [Current System State](#19-current-system-state)

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
- Personalized feed or recommendation algorithm ("For You")
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

### `user_preferences`
| Column | Type | Notes |
|---|---|---|
| user_id | UUID | PK + FK → `auth.users.id` ON DELETE CASCADE |
| theme | TEXT | CHECK: `system`, `light`, `dark`; default `system` |
| updated_at | TIMESTAMPTZ | Updated on each preference write |

One row per user, auto-created on signup via the `handle_new_user` trigger. Stores UI preferences only — not used for feed personalization or content ranking.

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
| `user_preferences` | Own row only | INSERT + UPDATE own row only (no DELETE — row persists until account deletion via CASCADE) |

> **Security note:** RESTRICTIVE deny policies are ANDed with all permissive policies — no future accidental permissive policy can re-open a blocked path.
> - Migrations 004 + 005: block `authenticated` from INSERT/UPDATE/DELETE on `events`, `event_updates`, and `users`; block `authenticated` INSERT on `event_updates`
> - Migration 007: block `authenticated` DELETE on `signals`; add `WITH CHECK (auth.uid() = user_id)` to `signals_update_own` to prevent post-update ownership reassignment
> - Migration 009: BEFORE UPDATE trigger enforces signal field immutability (user_id, event_id, created_at); `recalculate_trust_score` and `ingest_event` REVOKED from PUBLIC; all SECURITY DEFINER functions use `SET search_path = public`
> - Migration 010: explicit `RESTRICTIVE FOR ALL TO anon USING (false)` on `signals` and `users` — the product rule "anonymous users do not enter the app" is now machine-verifiable via `pg_policies`
> - Migration 018: `user_preferences` — `deny_prefs_anon` RESTRICTIVE (ALL TO anon) + `deny_prefs_delete` RESTRICTIVE (DELETE TO authenticated); permissive policies grant read/write to own row only
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
- Same title (case-insensitive, leading/trailing whitespace trimmed) exists within the last 10 minutes

Migration 014 added case-insensitive dedup via `lower(title)` comparison and a matching functional index (`CREATE INDEX ON events (lower(title)) WHERE created_at > NOW() - INTERVAL '10 minutes'`) for query performance.

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
│   ├── EventCard.tsx        # Card with vote buttons (signal state via props, no per-card fetch)
│   ├── SignalButton.tsx      # Shared Confirm/Dispute button — active/faded/loading/disabled states
│   └── StatusBadge.tsx      # Shared status badge — border + subtle tint + uppercase label
├── context/
│   ├── AuthContext.tsx      # Single AuthProvider + useAuth — one subscription for the app
│   └── ThemeContext.tsx     # ThemeProvider + useTheme — resolves preference → scheme → navTheme
├── lib/
│   ├── eventUtils.ts        # STATUS_LABEL, STATUS_COLOR, scoreColor — single source of truth for all status display logic
│   ├── formatRelativeTime.ts  # "just now" / "5m ago" / "3h ago" helper
│   └── supabase.ts          # Supabase client (env-var validated, chunked SecureStore)
├── hooks/
│   ├── useAuth.ts              # Re-export from AuthContext (no subscription)
│   ├── useEvents.ts            # Event list fetch + realtime (UPDATE + INSERT)
│   ├── useEventDetail.ts       # Event + updates fetch + realtime
│   ├── useUserSignal.ts        # Single-event signal fetch + upsert (EventDetailScreen)
│   ├── useUserSignals.ts       # Bulk signal fetch for all events (EventListScreen, one query)
│   └── useUserPreferences.ts   # Fetch + upsert user_preferences row (theme)
├── screens/
│   ├── SignInScreen.tsx
│   ├── EventListScreen.tsx
│   ├── EventDetailScreen.tsx
│   └── SettingsScreen.tsx       # Theme picker (System/Light/Dark) + Sign Out
├── services/
│   └── signalService.ts     # castSignal(userId, eventId, type) — upsert only (trigger handles score)
└── types/
    ├── index.ts             # DB types: Event, EventUpdate, Signal, User, UserPreferences, ThemePreference
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
│   ├── 015_reconciliation_functions.sql
│   ├── 016_compute_trust_score_formula.sql
│   ├── 017_drop_signals_delete_own.sql
│   └── 018_user_preferences.sql
├── ingestion/                     # V1 ingestion pipeline (adapter → normalize → write)
│   ├── types.ts                   # RawSourceItem, NormalizedEvent, SourceAdapter, IngestionResult
│   ├── client.ts                  # createIngestionClient() — service_role Supabase client
│   ├── normalize.ts               # normalizeSourceItem(): RawSourceItem → NormalizedEvent
│   ├── ingest.ts                  # ingestEvent(): write gate (calls ingest_event RPC only)
│   ├── run.ts                     # CLI runner: --adapter=<name> [--fixture=<path>] [--dry-run] [--limit=N]
│   ├── test_normalize.ts          # Normalization test runner (32 cases, no framework needed)
│   ├── adapters/
│   │   ├── sample.ts              # SampleAdapter — 15 mock events for dev/testing
│   │   └── fixture.ts             # FixtureAdapter — reads RawSourceItem[] from a JSON file
│   └── fixtures/
│       └── example.json           # Example fixture: 3 items showing full RawSourceItem shape
├── scripts/
│   └── verify_db.sql              # Read-only schema verification (run after applying all migrations)
└── seed/
    └── ingest.ts                  # Quick seed shorthand (calls ingest_event RPC directly)
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
| `loading === true` | Branded splash screen (IRIS wordmark + muted spinner) |
| `userId === null` | `SignInScreen` (outside navigator) |
| `userId` set | `ThemeProvider` → `ThemedApp` → `NavigationContainer` + stack |

`ThemeProvider` is only mounted when authenticated — preferences are per-user. `ThemedApp` calls `useTheme()` to get the resolved navigation theme and status bar style, then renders the `NavigationContainer` and the full stack.

### Sign In / Sign Up

- Email + password via `supabase.auth.signInWithPassword` and `supabase.auth.signUp`
- Separate **Sign In** and **Sign Up** buttons on the same form
- Inline validation: non-empty fields, password ≥ 6 characters
- Sign Up flow: confirmation email sent → "Check your email" screen → back to sign in
- UI states: form → per-button loading spinner → error inline / confirmation screen

### Sign Out

- Header button on Event List screen (alongside ⚙ settings icon) and Event Detail screen
- Also available in the Settings screen (Account section)
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
- Exposes: `{ event, updates, loading, refreshing, error, refetch }`
  - `loading` is `true` only on the initial fetch (shows full-screen spinner)
  - `refreshing` is `true` on pull-to-refresh (mirrors `useEvents` pattern)
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

Returns `{ currentSignal, fetchLoading, submitting, error, submitSignal }`.

**On mount:** fetches existing signal from DB via `.maybeSingle()`. `fetchLoading` is `true` until this resolves — `EventDetailScreen` renders inert placeholder button shapes during this window to avoid the idle-colored → active-filled flash that would otherwise occur on navigation.
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

## 12. User Preferences

### `useUserPreferences(userId)`

Low-level hook. Reads and writes the current user's `user_preferences` row directly. Most components should use `useTheme()` instead (see below).

- **Fetch:** single `.maybeSingle()` query on mount; `loading` starts `true` immediately when `userId` is known
- **Update:** `updateTheme(theme)` — optimistic update, then upserts `{ user_id, theme, updated_at }` with `onConflict: 'user_id'`; on failure, re-fetches DB state to revert to ground truth
- **Unauthenticated:** returns `preferences: null`, `updateTheme` is a no-op
- **Auto-row:** every authenticated user has a preferences row created by `handle_new_user` on signup (default `theme: 'system'`); the insert policy allows a bootstrap upsert for accounts that predate migration 018

**No RPC needed.** Direct `supabase.from('user_preferences')` access is safe because RLS restricts reads and writes to the authenticated user's own row.

### `ThemeProvider` + `useTheme()`

`ThemeContext` wraps the authenticated navigation stack in `App.tsx`.

- Reads from `useUserPreferences(userId)` internally
- Resolves `'system'` preference via `useColorScheme()` (falls back to `'dark'` when device scheme is unavailable)
- Exposes `{ preference, resolvedScheme, navTheme, updateTheme, loading }`
- `navTheme` is passed directly to `<NavigationContainer theme={navTheme}>` — navigation chrome adapts automatically
- `StatusBar` style in `ThemedApp` is reactive: `'light'` (white icons) for dark scheme, `'dark'` (black icons) for light scheme

**Consuming theme in a screen:**
```ts
const { preference, resolvedScheme, updateTheme } = useTheme();
// resolvedScheme is always 'light' | 'dark' — safe for style decisions
```

### Settings Screen

`SettingsScreen` is accessible via the ⚙ icon in the `EventList` header.

- **Appearance section:** radio-style rows for System / Light / Dark; calls `updateTheme()` on tap
- **Account section:** Sign Out button
- Styles adapt to the current `resolvedScheme` — the screen correctly re-renders when the user changes their theme

### Feed Support Boundaries

`user_preferences` stores UI state only. The following are explicitly **not** implemented and are **not** planned as extensions of this table:

| Feature | Status |
|---|---|
| "For You" feed | Not implemented — no infrastructure added |
| Content personalization | Not implemented — feed order is not preference-driven |
| Recommendation algorithm | Not implemented |
| Behavioral tracking | Not implemented |
| Source preference / weighting | Not implemented |

Any future feed personalization feature would require a separate design decision and a new migration. The `user_preferences` table will not be repurposed for that.

---

## 13. UI Structure

### Event List Screen

| State | Renders |
|---|---|
| Loading | `ActivityIndicator` |
| Error | Message + Retry button |
| Empty | "No events yet." |
| Data | `FlatList` of event rows |

Each card: title, colored status badge (colored border + text + subtle background tint), trust score bar (color-coded: green ≥67 / orange ≥34 / red <34), Confirm/Dispute signal buttons.  
Signal buttons: semantic color system — idle state uses colored border + colored text (green for Confirm, red for Dispute); active state uses filled background + white text; submitting state shows white spinner on colored fill.  
Vote state seeded from `useUserSignals` bulk fetch (one query for all cards); selected button fills solid, unselected fades (opacity 0.35).  
Pull-to-refresh supported. Header: IRIS wordmark (letter-spaced) + ⚙ settings icon + Sign Out button.

### Event Detail Screen

| State | Renders |
|---|---|
| Loading | `ActivityIndicator` |
| Error | Message + Retry button |
| Data | Header + timeline list |

Header: title (22px/700), colored status badge (matching EventCard style), trust score label + color-coded progress bar, signal section.  
Signal section: while `fetchLoading` is true, renders neutral placeholder button shapes to prevent the idle-color flash; once resolved, renders full Confirm/Dispute buttons with semantic colors matching EventCard.  
Timeline: structured with left-gutter dot + connector line; each item shows source name (linked if URL present), content text, and relative timestamp.

### Signal Section

Shown in the `EventDetailScreen` header. The screen is only reachable when authenticated (App.tsx auth gate), so `SignalSection` always renders the signed-in state.

Three visual states:
1. **Fetching** (`fetchLoading`): two neutral placeholder button shapes; prevents idle-color flash while the initial signal fetch completes
2. **Idle**: Confirm button with green border + green text; Dispute button with red border + red text
3. **Active**: selected button filled with accent color + white text; unselected button faded (opacity 0.35); both disabled while `submitting`

Inline error shown below buttons on submission failure.

---

## 14. Error Handling

- Raw DB / Supabase error messages are never shown to users
- User-facing messages: `"Unable to load events"`, `"Unable to load event"`, `"Could not save signal. Please try again."`
- All raw errors logged via `console.error` with a `[hook-name]` prefix for tracing
- Signal submission failure reverts the optimistic update and shows the user-facing error message

---

## 15. Performance Decisions

- No refetch after signal submission — realtime is the sync mechanism
- `Promise.all` for parallel event + updates fetch
- No global state library — no unnecessary re-renders from unrelated state
- Queries are minimal (no overfetching — `select('*')` on small tables only)
- Realtime channels scoped per event — no broadcast to unrelated screens
- `useUserSignals` fetches all user signals in one query instead of one per card (eliminates N+1 on the list screen)

---

## 16. Environment Config

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

## 17. TypeScript

- `strict: true` enabled in `tsconfig.json`
- `noUncheckedIndexedAccess` not enabled
- Types aligned directly with DB schema (no ORM layer)
- `EventStatus` and `SignalType` are string union types (not enums)

---

## 18. Setup

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
supabase/migrations/016_compute_trust_score_formula.sql
supabase/migrations/017_drop_signals_delete_own.sql
supabase/migrations/018_user_preferences.sql
```

**4a. Verify schema** (optional — confirms all migrations applied correctly)
```sql
-- Run supabase/scripts/verify_db.sql in the SQL Editor.
-- All rows should show 'PASS'.
```

**5. Enable Realtime** in Supabase Dashboard → Database → Replication:
- Enable for `events` table
- Enable for `event_updates` table

**6. Seed / ingest events (optional)**
```bash
# Add SUPABASE_SERVICE_KEY to .env first (service_role key from Supabase dashboard)

# Test normalization layer (no DB connection needed)
npx tsx supabase/ingestion/test_normalize.ts

# Dry run — see what would be ingested (no DB writes)
npx tsx supabase/ingestion/run.ts --dry-run

# Dry run against a custom fixture file
npx tsx supabase/ingestion/run.ts --fixture=./my_events.json --dry-run

# Dry run against the built-in example fixture
npx tsx supabase/ingestion/run.ts --adapter=fixture --dry-run

# Live ingest (requires SUPABASE_SERVICE_KEY in .env)
npx tsx supabase/ingestion/run.ts --adapter=sample
npx tsx supabase/ingestion/run.ts --fixture=./my_events.json
npx tsx supabase/ingestion/run.ts --adapter=sample --limit=3   # first 3 only

# Quick seed shorthand (bypasses adapter/normalize layers)
npx tsx supabase/seed/ingest.ts
```

**7. Start the app**
```bash
npx expo start
```

---

## 19. Current System State

### Implemented

- Event feed (list + detail) with dark-theme design system (premium, calm, information-dense)
- EventCard: status badge with semantic color + subtle tint fill, trust score bar (color-coded), source count, relative timestamp, Confirm/Dispute signal buttons
  - Signal buttons: semantic idle colors (green/red border + text); active state (filled background + white text); submitting state (white spinner on fill); non-selected fades at 0.35 opacity
- Status filter tab bar on event list (All / Emerging / Developing / Verified / Disputed) — client-side, no extra fetch
- Pull-to-refresh on both event list and event detail screens
- Timeline updates with left-gutter dot + connector visual; tappable source URLs (opens in browser); relative timestamps
- Dynamic navigation header title on EventDetail (shows event title once loaded)
- Source count + trust score bar displayed on both EventCard and EventDetail header
- User signaling (confirm / dispute) on both list cards and detail screen
  - List: vote state seeded from bulk fetch (`useUserSignals`) — one query for all cards
  - Detail: per-event fetch via `useUserSignal`; `fetchLoading` skeleton prevents visual flash on navigation; optimistic update with revert on failure; state persists across navigation
- Trust score calculation (server-side Postgres trigger + SECURITY DEFINER function — atomic, always in sync)
- Realtime synchronization:
  - List screen: `events-feed` channel handles both UPDATE (trust score, status) and INSERT (new events, prepended + deduplicated)
  - Detail screen: two channels for event UPDATE + event_updates INSERT (deduped by id)
- Authentication (email + password via `signInWithPassword` / `signUp`)
  - Branded launch screen (IRIS wordmark + muted spinner) during auth check
  - IRIS wordmark (letter-spaced) on both SignIn screen and navigation header
  - Email regex validation before Supabase call
  - Sign Out button accessible from both EventList and EventDetail headers
- Shared event display constants (`src/lib/eventUtils.ts`): STATUS_LABEL, STATUS_COLOR, scoreColor — single source of truth across all three screens
- Error boundary wrapping the full navigation stack (crash recovery screen)
- `formatRelativeTime` helper: "just now" / "5m ago" / "3h ago" / "2d ago"
- V1 ingestion pipeline (`supabase/ingestion/`): layered architecture separating source fetch, normalization, and write; all writes go through `ingest_event` RPC (service_role only); `--dry-run` mode; `--limit=N` for batch testing; SampleAdapter with 15 realistic events; adapter registry for adding real sources
  - `types.ts`: `RawSourceItem` (adapter output) → `NormalizedEvent` (IRIS DB shape); `SourceAdapter` interface; `IngestionResult`
  - `normalize.ts`: `normalizeSourceItem()` — validates headline/status/content/source_name, trims whitespace, assembles updates array; throws `NormalizationError` on bad input
  - `ingest.ts`: `ingestEvent()` — write gate, calls `ingest_event` RPC, returns `ok` / `skipped` / `error`
  - `run.ts`: CLI runner `npx tsx supabase/ingestion/run.ts [--adapter=<name>] [--fixture=<path>] [--dry-run] [--limit=N]`; `--fixture=<path>` implies `--adapter=fixture`
  - `test_normalize.ts`: 32-case normalization test suite (no framework); `npx tsx supabase/ingestion/test_normalize.ts`; covers all good/bad input combinations
  - `adapters/sample.ts`: `SampleAdapter` — 15 mock events in `RawSourceItem` shape
  - `adapters/fixture.ts`: `FixtureAdapter` — reads `RawSourceItem[]` from a JSON file; default `fixtures/example.json`, overridden by `--fixture=<path>` or `FIXTURE_PATH` env var
  - `fixtures/example.json`: 3-item example showing full `RawSourceItem` shape (all optional fields)
- Quick seed script (`npx tsx supabase/seed/ingest.ts`) calls `ingest_event` RPC directly (bypasses adapter/normalize layers)
- Production hardening: sanitized errors, realtime payload type guards, realtime dedup, signal no-op guard, isMounted guard, SecureStore chunk write-order fix
- Case-insensitive ingestion dedup (migration 014): `ingest_event` compares titles via `lower(title)` — "Breaking News" and "breaking news" deduplicate correctly; functional index on `lower(title)` covers the dedup query without a sequential scan
- Admin reconciliation functions (migration 015): `reconcile_source_counts()` and `reconcile_trust_scores()` repair denormalized counters after any out-of-band data operations; service_role only, SECURITY DEFINER
- Unified trust score formula (migration 016): `compute_trust_score(confirms, disputes)` is the single authoritative scoring function (IMMUTABLE SQL); both `recalculate_trust_score` and `reconcile_trust_scores` delegate to it — formula lives in one place, drift between trigger path and reconciliation tool is structurally impossible
- Security:
  - RESTRICTIVE deny policies on all write paths for `authenticated` (migrations 004, 005, 007): events INSERT/UPDATE/DELETE, event_updates INSERT/UPDATE/DELETE, users INSERT/UPDATE/DELETE, signals DELETE
  - Explicit RESTRICTIVE deny for `anon` role on signals and users (migration 010): product rule machine-verifiable via pg_policies
  - `signals_update_own` WITH CHECK prevents post-update user_id/event_id reassignment (migration 007); `signals_insert_own` WITH CHECK prevents inserting signals for other users (migration 001)
  - Dead permissive DELETE policy `signals_delete_own` dropped (migration 017): pg_policies now unambiguously shows only the RESTRICTIVE deny for signal deletes
  - BEFORE UPDATE trigger enforces signal field immutability: user_id, event_id, created_at cannot be changed after creation (migration 009)
  - Trust score trigger is SECURITY DEFINER + SET search_path=public; SELECT FOR UPDATE serializes concurrent recomputations; fires on INSERT OR UPDATE OR DELETE — covers user account cascade-delete path (migrations 006, 009, 013)
  - `recalculate_trust_score`, `ingest_event`, `reconcile_source_counts`, `reconcile_trust_scores`, `compute_trust_score` all REVOKED from PUBLIC, GRANT to service_role only (migrations 009, 011–016)
  - All SECURITY DEFINER functions have SET search_path=public (migrations 006, 008, 009, 011–016)
  - Source_count trigger hardened to SECURITY DEFINER; dead function `increment_source_count` removed (migration 008)
- Schema verification script: `supabase/scripts/verify_db.sql` — read-only SQL verifying RLS, RESTRICTIVE policy expressions, SECURITY DEFINER functions, trigger timing/events, EXECUTE grants, CHECK constraints, functional indexes, signal permissive policy ownership, and user_preferences table integrity (001–018)
- User preferences backend (migration 018): `user_preferences` table — theme preference (`system` | `light` | `dark`), auto-created on signup via `handle_new_user` trigger, RLS own-row read/update, RESTRICTIVE anon deny + RESTRICTIVE delete deny; `useUserPreferences(userId)` hook — fetch + optimistic upsert + revert on failure
- Theme preference applied to the navigation chrome: `ThemeContext` (`src/context/ThemeContext.tsx`) resolves `user_preferences.theme` using `useColorScheme()` for `'system'`; `navTheme` wired into `<NavigationContainer>` so headers/tabs adapt; `StatusBar` style reactive to resolved scheme
- Settings screen (`src/screens/SettingsScreen.tsx`): theme picker (System / Light / Dark) with radio-style selection; Account section with Sign Out; styles adapt to resolved scheme so the screen remains legible after a theme change; accessible via ⚙ icon in EventList header

### Not Implemented

- Session persistence across restarts (disabled for Expo Go; re-enable SecureStoreAdapter + `persistSession: true` in `supabase.ts` for production EAS builds)
- Full light-theme screen styles: `ThemeContext` drives the navigation chrome and `SettingsScreen`; all other screen `StyleSheet` objects use hardcoded dark colors. A complete light-theme pass would update all screen backgrounds, text, and component colors — deferred pending product decision on light-theme support
- Offline / no-connection indicator
- Push notifications
- Rate limiting / abuse protection
- Advanced ingestion (AI-assisted, fuzzy dedup)
- Reputation or source weighting
- Automated moderation
- Analytics
- "For You" feed / personalized content ranking — explicitly deferred; `user_preferences` table is not designed to support this and will not be extended for it without a separate design decision
