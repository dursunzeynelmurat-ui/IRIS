/**
 * Returns a short human-readable relative time string.
 * e.g. "just now", "5m ago", "3h ago", "2d ago"
 */
export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';

  const diffMs  = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60)                       return 'just now';
  if (diffSec < 3600)                     return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400)                    return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7)               return `${Math.floor(diffSec / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Returns a formatted absolute timestamp for intelligence timeline items.
 * - Within 24 hours: "2:30 PM"
 * - Within 7 days:   "Mon 2:30 PM"
 * - Older:           "Jan 4"
 */
export function formatTimelineTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';

  const diffHours = (Date.now() - d.getTime()) / 3_600_000;

  if (diffHours < 24) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (diffHours < 24 * 7) {
    return (
      d.toLocaleDateString(undefined, { weekday: 'short' }) +
      ' ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    );
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
