# IRIS

A mobile application that presents real-time events and continuously reflects how reliable those events are through user-driven signals and source-based updates.

IRIS does not deliver news articles. It represents events as evolving entities with changing confidence levels.

---

## What IRIS Does

### Event Feed
- Displays a list of ongoing events, sorted by recency
- Each event shows: title, status, trust score

### Event Evolution
- Each event contains a timeline of updates from different sources
- Updates are appended chronologically — never overwritten or removed

### Trust Score
- Calculated dynamically from user signals (confirm / dispute)
- Computed server-side via Postgres RPC
- Reflected instantly through realtime subscriptions

### User Signaling
- Users can confirm or dispute any event
- One signal per user per event (upsert — signal can be changed)

### Realtime Sync
- Event changes and trust score updates propagate instantly
- New timeline entries appear without a manual refresh

---

## What IRIS Does Not Do

- No comments, replies, discussions, or reactions
- No user-created events or updates
- No personalized feed or recommendation algorithm
- No editorial curation or moderation (MVP scope)
- No source weighting

---

## How It Works (End-to-End)

```
1. Event created via ingestion script       → initial trust_score = 50
2. Updates appended as event_updates        → source_count increments via DB trigger
3. User opens event, submits signal         → confirm or dispute
4. Signal stored via upsert                 → RPC recalculates trust_score
5. DB emits UPDATE via realtime             → all connected clients update instantly
```

---

## Screens

| Screen | Purpose |
|---|---|
| Sign In | Email magic link — required for signaling, not for reading |
| Event List | Entry point — all events, minimal data |
| Event Detail | Single event: metadata, trust score, timeline, signal controls |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Mobile | React Native (Expo) + TypeScript |
| Backend / DB | Supabase (PostgreSQL + Auth + Realtime) |

---

## Database Schema

| Table | Purpose |
|---|---|
| `events` | Core events with status, trust_score, source_count |
| `event_updates` | Timeline entries linked to an event |
| `signals` | User confirm/dispute signals (unique per user+event) |
| `users` | Public profile mirroring `auth.users` |

Key constraints:
- `UNIQUE(user_id, event_id)` on `signals` — one signal per user per event
- `source_count` kept in sync via DB trigger on `event_updates`
- `trust_score` updated via `recalculate_trust_score(event_id)` RPC

---

## Project Structure

```
src/
├── hooks/
│   ├── useAuth.ts           # Session state
│   ├── useEvents.ts         # Event list fetch
│   ├── useEventDetail.ts    # Event + updates fetch + realtime
│   └── useUserSignal.ts     # Signal fetch + upsert + RPC
├── screens/
│   ├── SignInScreen.tsx
│   ├── EventListScreen.tsx
│   └── EventDetailScreen.tsx
├── lib/
│   └── supabase.ts          # Supabase client
└── types/
    ├── index.ts             # DB types (Event, EventUpdate, Signal, User)
    └── navigation.ts        # React Navigation param types

supabase/
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_recalculate_trust_score.sql
└── seed/
    └── ingest.ts            # Ingestion script with duplicate guard
```

---

## Setup

**1. Clone and install**
```bash
git clone <repo>
cd IRIS
npm install
```

**2. Configure environment**
```bash
cp .env.example .env
# Fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
# Add SUPABASE_SERVICE_KEY for the ingestion script
```

**3. Apply database migrations**

Run in Supabase SQL Editor (in order):
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_recalculate_trust_score.sql`

**4. Seed data (optional)**
```bash
npx tsx supabase/seed/ingest.ts
```

**5. Start the app**
```bash
npx expo start
```

---

## Current MVP Scope

**Included:**
- Event feed + detail view
- Timeline updates
- User signaling (confirm / dispute)
- Trust score calculation (server-side RPC)
- Realtime synchronization
- Basic authentication (email magic link)

**Not included:**
- Automated source ingestion or scraping
- Advanced moderation systems
- Reputation systems
- AI-assisted verification
- Offline mode
- Analytics tracking

---

## System Boundaries

- Users evaluate information — they do not create it
- Events evolve — they are not replaced
- Trust is calculated — not interpreted or editorially weighted
- Data is shown to all users equally — no personalization
