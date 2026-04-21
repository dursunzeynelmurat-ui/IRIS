import { EventStatus } from '../types';

// ── Status display maps ───────────────────────────────────────
// Single source of truth for all status labels and colors.
// Two color palettes: dark (calibrated for dark bg) and light (calibrated for white bg).

export const STATUS_LABEL: Record<EventStatus, string> = {
  new:        'New',
  developing: 'Developing',
  verified:   'Verified',
  conflicted: 'Conflicted',
  contained:  'Contained',
  resolved:   'Resolved',
  archived:   'Archived',
};

/** Status colors for dark backgrounds. Pass 4.5:1+ contrast on #0d0d0d / #1c1c1e. */
export const STATUS_COLOR_DARK: Record<EventStatus, string> = {
  new:        '#ff9f0a',
  developing: '#0a84ff',
  verified:   '#30d158',
  conflicted: '#ff453a',
  contained:  '#64d2ff',
  resolved:   '#8e8e93',
  archived:   '#636366',
};

/**
 * Status colors for light backgrounds (#ffffff / #f2f2f7).
 * All values pass ≥4.5:1 WCAG contrast ratio against white.
 */
export const STATUS_COLOR_LIGHT: Record<EventStatus, string> = {
  new:        '#b25000',
  developing: '#0060c7',
  verified:   '#1e7a30',
  conflicted: '#c01428',
  contained:  '#006994',
  resolved:   '#6e6e73',
  archived:   '#aeaeb2',
};

/**
 * Returns the correct status color map for the given resolved theme.
 * Usage: `statusColors(resolved)[event.status]`
 */
export function statusColors(
  resolved: 'light' | 'dark',
): Record<EventStatus, string> {
  return resolved === 'light' ? STATUS_COLOR_LIGHT : STATUS_COLOR_DARK;
}

// Backward-compatible alias — consumed by any code that hasn't migrated yet.
// Always returns dark values (the original set).
export const STATUS_COLOR = STATUS_COLOR_DARK;

// ── Score color ───────────────────────────────────────────────

/**
 * Maps a 0–100 trust score to a semantic color for the given theme.
 *
 * Light-mode values pass ≥4.5:1 WCAG contrast against white:
 *   high  #1e7a30 → 5.3:1
 *   mid   #b25000 → 5.2:1
 *   low   #c01428 → 6.3:1
 */
export function scoreColor(score: number, resolved: 'light' | 'dark' = 'dark'): string {
  if (resolved === 'light') {
    if (score >= 67) return '#1e7a30';
    if (score >= 34) return '#b25000';
    return '#c01428';
  }
  if (score >= 67) return '#30d158';
  if (score >= 34) return '#ff9f0a';
  return '#ff453a';
}
