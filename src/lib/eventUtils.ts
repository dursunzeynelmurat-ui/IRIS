import { EventStatus } from '../types';

// ── Status display maps ───────────────────────────────────────
// Single source of truth for all status labels and colors.
// Used by EventCard, EventDetailScreen, and EventListScreen.

export const STATUS_LABEL: Record<EventStatus, string> = {
  emerging:   'Emerging',
  developing: 'Developing',
  verified:   'Verified',
  disputed:   'Disputed',
};

export const STATUS_COLOR: Record<EventStatus, string> = {
  emerging:   '#ff9f0a',
  developing: '#0a84ff',
  verified:   '#30d158',
  disputed:   '#ff453a',
};

/** Maps a 0–100 trust score to a semantic color. */
export function scoreColor(score: number): string {
  if (score >= 67) return '#30d158';
  if (score >= 34) return '#ff9f0a';
  return '#ff453a';
}
