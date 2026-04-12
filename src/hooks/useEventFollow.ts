/**
 * useEventFollow — follow/unfollow state for a single event.
 *
 * Fetches the current follow state for (userId, eventId) from event_follows
 * and exposes a toggle function backed by the toggle_event_follow RPC.
 *
 * OPTIMISTIC UPDATE:
 *   toggleFollow flips local state immediately, then calls the RPC.
 *   On failure it reverts the local state and surfaces an error message.
 *   This matches the pattern used by useUserSignal.
 *
 * UNAUTHENTICATED:
 *   If userId is null/undefined the hook returns followed=false and a no-op
 *   toggle. The caller does not need to guard against this case.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface UseEventFollowResult {
  followed: boolean;
  loading: boolean;   // true during initial fetch
  toggling: boolean;  // true during toggle RPC call
  error: string | null;
  toggleFollow: () => Promise<void>;
}

export function useEventFollow(
  eventId: string,
  userId: string | null | undefined,
): UseEventFollowResult {
  const [followed, setFollowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Initial fetch ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!userId || !eventId) {
      setFollowed(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from('event_follows')
      .select('user_id')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError('Failed to load follow state.');
        } else {
          setFollowed(data !== null);
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [eventId, userId]);

  // ── Toggle ─────────────────────────────────────────────────────────────

  const toggleFollow = useCallback(async () => {
    if (!userId || !eventId || toggling) return;

    const prev = followed;
    setFollowed(!prev);   // optimistic
    setToggling(true);
    setError(null);

    const { data, error: rpcError } = await supabase
      .rpc('toggle_event_follow', { p_event_id: eventId });

    setToggling(false);

    if (rpcError) {
      setFollowed(prev);  // revert
      setError('Failed to update follow. Please try again.');
      return;
    }

    // Sync to RPC truth in case the optimistic guess was wrong
    // (e.g. concurrent toggle from another session).
    if (data === 'followed') setFollowed(true);
    if (data === 'unfollowed') setFollowed(false);
  }, [eventId, userId, followed, toggling]);

  return { followed, loading, toggling, error, toggleFollow };
}
