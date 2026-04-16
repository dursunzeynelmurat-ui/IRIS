// ============================================================
// IRIS — Core TypeScript Types
// Mirrors the database schema exactly.
// ============================================================

export type EventStatus = 'emerging' | 'developing' | 'verified' | 'disputed';

export type SignalType = 'confirm' | 'dispute';

/** Feed mode corresponding to the three tabs in the IRIS feed UI. */
export type FeedMode = 'new' | 'verified' | 'rising';

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
  /** Hero image URL. NULL until populated by ingestion. */
  image_url: string | null;
  /** Short contextual summary (1-3 sentences). Shown on card and detail header. NULL until populated. */
  summary: string | null;
  /** Timestamp of the most recent event_update. Drives "Xm ago" display and feed ordering. NULL if no updates yet. */
  latest_update_at: string | null;
  created_at: string;
}

// public.event_follows
export interface EventFollow {
  user_id: string;
  event_id: string;
  created_at: string;
}

/** Classification of an event_update for timeline icon and color coding. */
export type UpdateType =
  | 'report'             // Standard report from a named source (default)
  | 'witness'            // Eyewitness or on-the-ground account
  | 'official'           // Statement from an official authority
  | 'confirmed'          // Explicitly confirms a prior report
  | 'under_verification' // Early/unverified signal; treat with caution
  | 'analysis'           // Contextual analysis or editorial assessment
  | 'correction';        // Corrects a prior update

// public.event_updates
export interface EventUpdate {
  id: string;
  event_id: string;
  content: string;
  source_name: string;
  source_url: string | null;
  /** FK to public.sources. NULL for updates not linked to a structured source. */
  source_id: string | null;
  /** Nature of the update for timeline rendering. Defaults to 'report'. */
  update_type: UpdateType;
  /** Short bold headline for the update (1 line). NULL for older updates. */
  headline: string | null;
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

/**
 * Card-ready event payload returned by get_feed_events RPC.
 * Subset of Event fields sufficient for feed card rendering.
 * Does NOT include source_score / crowd_score (detail-page only).
 */
export interface EventCard {
  id: string;
  title: string;
  image_url: string | null;
  summary: string | null;
  status: EventStatus;
  trust_score: number;
  source_count: number;
  follow_count: number;
  latest_update_at: string | null;
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
