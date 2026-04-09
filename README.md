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

### Trust Score (RPC)

Implemented as a Postgres function: `recalculate_trust_score(p_event_id UUID)`

```sql
trust_score = ROUND(confirms / (confirms + disputes) * 100)
```

Rules:
- If total signals = 0 → no update (divide-by-zero guard)
- Score clamped 0–100
- SELECT count + UPDATE run in one transaction (atomic, race-safe)

### Source Count

Incremented automatically via DB trigger on INSERT into `event_updates`.

---

## 4. Security

### Row Level Security

| Table | Read | Write |
|---|---|---|
| `events` | Public | — |
| `event_updates` | Public | Authenticated users (INSERT only) |
| `signals` | Own rows only | Own rows only (INSERT, UPDATE, DELETE) |
| `users` | Own row only | — |

---

## 5. Backend Patterns

### Signal Submission Flow

1. Client performs upsert on `signals`:
   ```sql
   ON CONFLICT (user_id, event_id)
   DO UPDATE SET type = EXCLUDED.type
   ```
2. On success: client calls `recalculate_trust_score(event_id)` RPC
3. DB updates `events.trust_score`
4. Realtime emits UPDATE → all subscribed clients update instantly

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
| Session storage | `@react-native-async-storage/async-storage` |
| Navigation | `@react-navigation/native-stack` |

### Folder Structure

```
src/
├── lib/
│   └── supabase.ts          # Supabase client (env-var validated)
├── hooks/
│   ├── useAuth.ts           # Session state + loading
│   ├── useEvents.ts         # Event list fetch
│   ├── useEventDetail.ts    # Event + updates fetch + realtime
│   └── useUserSignal.ts     # Signal fetch + upsert + RPC
├── screens/
│   ├── SignInScreen.tsx
│   ├── EventListScreen.tsx
│   └── EventDetailScreen.tsx
└── types/
    ├── index.ts             # DB types: Event, EventUpdate, Signal, User
    └── navigation.ts        # RootStackParamList

supabase/
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_recalculate_trust_score.sql
└── seed/
    └── ingest.ts
```

---

## 7. State Management

- No global state library
- All data managed via custom hooks
- Supabase is the single source of truth
- React local state only (`useState`, `useEffect`)

---

## 8. Auth System

### `useAuth` Hook

Returns `{ userId: string | null, loading: boolean }`.

- Reads session on mount via `getSession()`
- Subscribes to `onAuthStateChange` for live updates
- `loading: true` until session is resolved — prevents UI flicker

### App-level Auth Gate (`App.tsx`)

Three-state conditional render:

| State | Renders |
|---|---|
| `loading === true` | `ActivityIndicator` spinner |
| `userId === null` | `SignInScreen` (outside navigator) |
| `userId` set | `NavigationContainer` + stack |

### Sign In

- Email-based magic link via `supabase.auth.signInWithOtp`
- `shouldCreateUser: true` (auto-creates account on first sign-in)
- UI states: input form → loading → "Check your email"

### Sign Out

- Header button on Event List screen
- Calls `supabase.auth.signOut()`
- `onAuthStateChange` fires → `userId` becomes null → app returns to `SignInScreen`

---

## 9. Data Fetching

### `useEvents`

- Fetches all events, ordered `created_at DESC`
- Exposes: `{ events, loading, error, refetch }`
- Error messages sanitized (raw DB errors never shown to user)

### `useEventDetail`

- Fetches event + updates in parallel via `Promise.all`
- Updates ordered `created_at ASC` (chronological timeline)
- Exposes: `{ event, updates, loading, error, refetch }`
- Also manages realtime subscriptions (see §10)

---

## 10. Realtime System

Both subscriptions live inside `useEventDetail` and are scoped to a single `eventId`.

### Channel 1 — `events` row

```
event: 'UPDATE', table: 'events', filter: id=eq.{eventId}
```
Patches the local `event` state with incoming fields (primarily `trust_score`).

### Channel 2 — `event_updates` rows

```
event: 'INSERT', table: 'event_updates', filter: event_id=eq.{eventId}
```
Appends new timeline entries. **Deduplicated by `id`** — ignores entries already present in state (guards against refetch/subscription overlap).

### Cleanup

Both channels removed via `supabase.removeChannel()` on component unmount.

### Trust Score Update Path

Signal submitted → RPC updates `events.trust_score` in DB → realtime UPDATE fires → Channel 1 patches UI. No manual refetch needed after signal submission.

---

## 11. Signal System

### `useUserSignal(eventId, userId)`

Returns `{ currentSignal, submitting, error, submitSignal }`.

**On mount:** fetches existing signal via `.maybeSingle()` (null if none).

**On `submitSignal(type)`:**

1. Guard: `if (type === currentSignal) return` — prevents no-op DB call
2. Optimistic update: `setCurrentSignal(type)`
3. Upsert to `signals` with `onConflict: 'user_id,event_id'`
4. On upsert error: revert optimistic update, set sanitized error message
5. On success: call `recalculate_trust_score` RPC
6. Realtime picks up the resulting `trust_score` change automatically

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

Each row: title, status (with unknown-value fallback), trust score.  
Header: Sign Out button (when signed in).

### Event Detail Screen

| State | Renders |
|---|---|
| Loading | `ActivityIndicator` |
| Error | Message + Retry button |
| Data | Header + timeline list |

Header: title, status, trust score, signal section.  
Timeline: source name, content, formatted timestamp (invalid date → `—`).

### Signal Section

| Auth state | Renders |
|---|---|
| Auth still loading | Nothing (prevents flash) |
| Not signed in | "Sign in to send a signal." |
| Signed in | Confirm + Dispute buttons |

Active button: filled background. Both disabled while `submitting`.  
Inline error shown below buttons on failure.

---

## 13. Error Handling

- Raw DB / Supabase error messages are never shown to users
- User-facing messages: `"Unable to load events"`, `"Unable to load event"`, `"Could not save signal. Please try again."`
- All raw errors logged via `console.error` with a `[hook-name]` prefix for tracing
- RPC failure after successful upsert is treated as non-fatal (signal is saved; score update may be delayed until realtime catches up)

---

## 14. Performance Decisions

- No refetch after signal submission — realtime is the sync mechanism
- `Promise.all` for parallel event + updates fetch
- No global state library — no unnecessary re-renders from unrelated state
- Queries are minimal (no overfetching — `select('*')` on small tables only)
- Realtime channels scoped per event — no broadcast to unrelated screens

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
```

**4. Enable Realtime** in Supabase Dashboard → Database → Replication:
- Enable for `events` table
- Enable for `event_updates` table

**5. Seed data (optional)**
```bash
# Add SUPABASE_SERVICE_KEY to .env first
npx tsx supabase/seed/ingest.ts
```

**6. Start the app**
```bash
npx expo start
```

---

## 18. Current System State

### Implemented

- Event feed (list + detail)
- Timeline updates (chronological)
- User signaling (confirm / dispute, upsert)
- Trust score calculation (server-side Postgres RPC)
- Realtime synchronization (trust score + timeline)
- Authentication (email magic link)
- Ingestion script with duplicate guard (15 seed events included)
- Production hardening: sanitized errors, auth loading state, realtime dedup, no-op signal guard

### Not Implemented

- Advanced error recovery / retry logic
- Rate limiting or abuse protection
- Offline support
- Analytics tracking
- Advanced ingestion (AI-assisted, scraping)
- Reputation or source weighting systems
- UI polish / design system
- Automated moderation
