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
