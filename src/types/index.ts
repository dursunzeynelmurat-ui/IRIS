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
  trust_score: number;   // 0–100, source-derived
  source_count: number;
  created_at: string;
  image_url?: string | null;  // optional — when backend provides it, renders automatically
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

// public.users
export interface User {
  id: string;
  email: string | null;
  created_at: string;
}
