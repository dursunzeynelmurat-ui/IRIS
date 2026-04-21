// ============================================================
// IRIS — Core TypeScript Types
// Mirrors the database schema exactly.
// ============================================================

export type EventStatus = 'emerging' | 'developing' | 'verified' | 'disputed';

export type SignalType = 'confirm' | 'dispute';

/** Feed tabs — shared between EventListScreen and feed preference settings. */
export type FeedTab = 'new' | 'verified' | 'rising';

// public.events
export interface Event {
  id: string;
  title: string;
  status: EventStatus;
  trust_score: number;           // 0–100, source-derived
  source_count: number;
  created_at: string;
  latest_update_at?: string | null; // maintained by trigger; use for recency display
  summary?: string | null;          // short overview shown on cards and detail header
  image_url?: string | null;        // optional — renders automatically when backend provides it
}

// public.event_updates
export interface EventUpdate {
  id: string;
  event_id: string;
  content: string;
  source_name: string;
  source_url: string | null;
  created_at: string;
  headline?: string | null;     // short editor-written summary line; primary display when present
  update_type?: string | null;  // 'development' | 'breaking' | 'context' | 'correction' | null
}

// public.signals
export interface Signal {
  id: string;
  user_id: string;
  event_id: string;
  type: SignalType;
  created_at: string;
}

// public.signal_submissions
export interface SignalSubmission {
  id: string;
  user_id: string;
  event_id: string | null;
  content: string;
  status: 'pending' | 'reviewed' | 'accepted' | 'rejected';
  created_at: string;
}

// public.users
export interface User {
  id: string;
  email: string | null;
  created_at: string;
}
