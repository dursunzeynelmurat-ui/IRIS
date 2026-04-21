// ============================================================
// IRIS — Core TypeScript Types
// Mirrors the database schema exactly.
// ============================================================

export type EventStatus =
  | 'new'         // First sighting; minimal confirmation
  | 'developing'  // Actively evolving with new information
  | 'verified'    // Confirmed by multiple reliable sources
  | 'conflicted'  // Contradictory source reporting
  | 'contained'   // Situation controlled; no longer spreading
  | 'resolved'    // Confirmed closure/resolution
  | 'archived';   // Removed from all feeds (stale or low-value)

export type SignalType = 'confirm' | 'dispute';

/** Feed mode corresponding to the three tabs in the IRIS feed UI. */
export type FeedMode = 'new' | 'verified' | 'rising';

/** Alias — used by frontend contexts and EventListScreen. */
export type FeedTab = FeedMode;

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

  // ── Phase 2 additions ──────────────────────────────────────────────────────
  /** URL-safe identifier derived from title + short UUID. */
  slug: string | null;
  /** High-level category: 'disaster' | 'conflict' | 'health' | 'politics' | 'economy' | null */
  category: string | null;
  subcategory: string | null;
  /** Controls feed surfacing independently of status. */
  visibility: 'visible' | 'low_visibility' | 'hidden_pending_review' | 'archived';
  /** Global / regional / local scope. */
  scope: 'global' | 'regional' | 'local';
  /** 0–100. Operational importance separate from trust. */
  importance_score: number;
  /** Pre-computed weighted feed ordering composite. */
  feed_rank: number;
  /** ISO 3166-1 alpha-2 codes for affected countries. */
  country_codes: string[];
  region_tags: string[];
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Timestamp of the first source item that created this event. */
  first_seen_at: string;
  /** When event metadata last changed. */
  last_updated_at: string | null;
  /** Count of VISIBLE event_updates (is_visible=true). */
  update_count: number;
  /** True when at least one official-tier source has confirmed. */
  official_confirmation: boolean;
  /** True when at least one event_source has stance='contradicts'. */
  conflict_flag: boolean;
}

// public.event_follows
export interface EventFollow {
  user_id: string;
  event_id: string;
  created_at: string;
  latest_update_at?: string | null;
  summary?: string | null;
  image_url?: string | null;
}

/** Classification of an event_update for timeline icon and color coding. */
export type UpdateType =
  // Phase 1 values — display-oriented
  | 'report'
  | 'witness'
  | 'official'
  | 'confirmed'
  | 'under_verification'
  | 'analysis'
  | 'correction'
  // Phase 2 values — lifecycle-oriented
  | 'first_report'
  | 'official_confirmation'
  | 'casualty_update'
  | 'location_refinement'
  | 'escalation'
  | 'deescalation'
  | 'denial'
  | 'contradiction'
  | 'closure'
  | 'generic_update';

// public.event_updates
export interface EventUpdate {
  id: string;
  event_id: string;
  content: string;
  source_name: string;
  source_url: string | null;
  source_id: string | null;
  update_type: UpdateType;
  headline: string | null;
  created_at: string;

  // ── Phase 2 additions ──────────────────────────────────────────────────────
  published_at: string | null;
  display_order_time: string | null;
  normalized_source_item_id: string | null;
  confidence: number;
  is_visible: boolean;
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
  credibility: number;
  source_type: SourceType;
  verified: boolean;
  created_at: string;
}

/**
 * Card-ready event payload returned by get_feed_events RPC.
 * Subset of Event fields sufficient for feed card rendering.
 */
export interface EventCard {
  id: string;
  title: string;
  image_url: string | null;
  summary: string | null;
  status: EventStatus;
  trust_score: number;
  importance_score: number;
  feed_rank: number;
  source_count: number;
  follow_count: number;
  latest_update_at: string | null;
  created_at: string;
  official_confirmation: boolean;
  conflict_flag: boolean;
  update_count: number;
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
  /** Which feed tab the user lands on when opening the app. */
  default_home_feed: FeedMode;
  updated_at: string;
}

/** Status lifecycle of a user-submitted signal lead (migration 040). */
export type SignalLeadStatus =
  | 'pending'
  | 'matched_existing_event'
  | 'created_new_event'
  | 'rejected'
  | 'rate_limited'
  | 'blocked';

/** Row from public.user_signal_leads as returned by get_my_signal_leads. */
export interface UserSignalLead {
  id: string;
  content: string;
  status: SignalLeadStatus;
  context_event_id: string | null;
  matched_event_id: string | null;
  rejection_reason: string | null;
  reputation_impact: number;
  created_at: string;
  processed_at: string | null;
}

/** Result of submit_signal_lead RPC. */
export interface SignalLeadSubmitResult {
  lead_id: string;
  status: SignalLeadStatus;
  message: string;
  blocked_until?: string;
}

/** Row from public.user_reputation as returned by get_my_reputation. */
export interface UserReputation {
  reputation_score: number;   // 0–200; 100 = neutral default
  total_leads: number;
  accepted_leads: number;
  rejected_leads: number;
  misleading_strikes: number;
  blocked_until: string | null;
}

/** Row from public.event_revisions — title/summary evolution history. */
export interface EventRevision {
  id: string;
  event_id: string;
  revision_type: 'title' | 'summary' | 'both';
  old_title: string | null;
  new_title: string | null;
  old_summary: string | null;
  new_summary: string | null;
  trigger_reason: string | null;
  triggered_by: 'ingestion' | 'recompute' | 'manual_admin';
  source_update_id: string | null;
  created_at: string;
}

// ── Phase 2 pipeline types ────────────────────────────────────────────────────

export type ReliabilityTier = 'low' | 'medium' | 'high' | 'official';
export type FeedSourceType = 'media_rss' | 'official_rss' | 'official_page';

/**
 * Determines when a feed is eligible for production polling (migration 036).
 *   active_allowed    — open feed, safe for production.
 *   dev_only          — dev/test only; excluded in production.
 *   licensed_required — must be manually enabled after license confirmed.
 */
export type SourcePolicy = 'active_allowed' | 'dev_only' | 'licensed_required';

/** Row from public.source_feeds. */
export interface SourceFeed {
  id: string;
  name: string;
  slug: string;
  source_type: FeedSourceType;
  feed_url: string;
  reliability_tier: ReliabilityTier;
  credibility_score: number;
  poll_interval_seconds: number;
  parser_type: 'rss2' | 'atom' | 'json_feed' | 'html_page';
  source_policy: SourcePolicy;
  is_active: boolean;
  health_score: number;
  last_fetched_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  linked_source_id: string | null;
  created_at: string;
}

/** Row from public.event_sources — per-event source attribution. */
export interface EventSourceAttribution {
  id: string;
  event_id: string;
  normalized_source_item_id: string | null;
  source_feed_id: string | null;
  source_name: string;
  source_type: string;
  source_url: string | null;
  published_at: string | null;
  reliability_tier: ReliabilityTier;
  stance: 'supports' | 'contradicts' | 'neutral';
  created_at: string;
}

/** Row from public.event_score_history — sparkline data point. */
export interface EventScoreSnapshot {
  id: string;
  event_id: string;
  trust_score: number;
  importance_score: number;
  status_snapshot: string | null;
  recorded_at: string;
}

/** Result row from get_event_sources_detail RPC. */
export interface EventSourceDetail {
  id: string;
  source_name: string;
  source_type: string;
  source_url: string | null;
  reliability_tier: ReliabilityTier;
  credibility_score: number | null;
  stance: 'supports' | 'contradicts' | 'neutral';
  published_at: string | null;
}
