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
  trust_score: number; // 0–100
  source_count: number;
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
