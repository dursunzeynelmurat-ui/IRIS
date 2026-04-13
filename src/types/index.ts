// ============================================================
// IRIS — Core TypeScript Types
// Mirrors the database schema exactly.
// ============================================================

export type EventStatus = 'emerging' | 'developing' | 'verified' | 'disputed';

export type SignalType = 'confirm' | 'dispute';

// public.events
export interface Event {
  id: string;
  title: string;
  status: EventStatus;
  /** Source-credibility-weighted score. AVG(source.credibility) for linked sources; 50 if none. */
  source_score: number; // 0–100
  /** Crowd signal score. Confirm-ratio (0–100); 50 when no signals. */
  crowd_score: number;  // 0–100
  /** Composite final score: clamp(source_score + (crowd_score - 50) * 0.2, 0, 100) */
  trust_score: number;  // 0–100
  source_count: number;
  follow_count: number; // denormalized; kept in sync by sync_follow_count trigger
  created_at: string;
}

// public.event_follows
export interface EventFollow {
  user_id: string;
  event_id: string;
  created_at: string;
}

// public.event_updates
export interface EventUpdate {
  id: string;
  event_id: string;
  content: string;
  source_name: string;
  source_url: string | null;
  created_at: string;
}

// public.signals
export interface Signal {
  id: string;
  user_id: string;
  event_id: string;
  type: SignalType;
  created_at: string;
}

// public.sources
export type SourceType = 'media' | 'official' | 'expert' | 'community';

export interface Source {
  id: string;
  name: string;
  domain: string | null;
  credibility: number;     // 0–100; 50 = neutral/unknown
  source_type: SourceType;
  verified: boolean;
  created_at: string;
}

/** Row returned by the get_event_sources RPC. */
export interface EventSourceInfo {
  source_id: string;
  name: string;
  domain: string | null;
  credibility: number;
  source_type: SourceType;
  verified: boolean;
  update_count: number;
}

// public.users
export interface User {
  id: string;
  email: string | null;
  created_at: string;
}

// public.user_preferences
export type ThemePreference = 'system' | 'light' | 'dark';

export interface UserPreferences {
  user_id: string;
  theme: ThemePreference;
  updated_at: string;
}
