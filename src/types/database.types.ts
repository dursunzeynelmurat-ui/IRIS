// ─────────────────────────────────────────────────────────────
// IRIS — Database Types
// Mirrors the Supabase schema exactly.
// Keep in sync with supabase/migrations/001_initial_schema.sql
// ─────────────────────────────────────────────────────────────

export type EventStatus = 'emerging' | 'developing' | 'verified' | 'disputed';
export type SignalType  = 'confirm'  | 'dispute';

export interface DbEvent {
  id:           string;
  title:        string;
  status:       EventStatus;
  trust_score:  number;       // 0–100
  source_count: number;
  created_at:   string;       // ISO 8601
}

export interface DbEventUpdate {
  id:          string;
  event_id:    string;
  content:     string;
  source_name: string;
  source_url:  string | null;
  created_at:  string;
}

export interface DbSignal {
  id:         string;
  user_id:    string;
  event_id:   string;
  type:       SignalType;
  created_at: string;
}

export interface DbUser {
  id:         string;
  email:      string | null;
  created_at: string;
}
