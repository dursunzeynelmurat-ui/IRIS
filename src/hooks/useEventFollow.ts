/**
 * useEventFollow — follow/unfollow state for a single event.
 *
 * Fetches the current follow state for (userId, eventId) from event_follows
 * and exposes a toggle backed by the toggle_event_follow RPC (migration 019).
 *
 * OPTIMISTIC UPDATE:
 *   toggle flips local state immediately, then calls the RPC.
 *   On failure it reverts the local state and surfaces an error message.
 *   The RPC returns 'followed'|'unfollowed' which is used to sync state
 *   in case the optimistic guess differed from the DB truth.
 *
 * UNAUTHENTICATED:
 *   If userId is null the hook returns isFollowing=null and a no-op toggle.
 *   The caller does not need to guard against this case.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface UseEventFollowResult {
  /** null = loading, true/false = resolved */
  isFollowing: boolean | null;
  /** true during initial data fetch */
  loading: boolean;
  /** true during toggle RPC call */
  toggling: boolean;
  error: string | null;
  toggle: () => Promise<void>;
}

export function useEventFollow(
  eventId: string,
  userId: string | null,
): UseEventFollowResult {
  // Start loading=true only when userId is already known to avoid a flash
  const [loading, setLoading]         = useState(userId !== null);
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [toggling, setToggling]       = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const cancelledRef                  = useRef(false);

  // ── Initial fetch ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      setIsFollowing(null);
      return;
    }

    cancelledRef.current = false;
    setLoading(true);

    supabase
      .from('event_follows')
      .select('user_id')
      .eq('user_id', userId)
      .eq('event_id', eventId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelledRef.current) return;
        if (err) {
          setError(err.message);
          setIsFollowing(false);
        } else {
          setIsFollowing(data !== null);
        }
        setLoading(false);
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [eventId, userId]);

  // ── Toggle ─────────────────────────────────────────────────────────────

  const toggle = useCallback(async () => {
    if (!userId || toggling) return;

    const wasFollowing = isFollowing ?? false;
    setIsFollowing(!wasFollowing); // optimistic
    setToggling(true);
    setError(null);

    const { data, error: rpcError } = await supabase
      .rpc('toggle_event_follow', { p_event_id: eventId });

    setToggling(false);

    if (rpcError) {
      setIsFollowing(wasFollowing); // revert
      setError(rpcError.message);
      return;
    }

    // Sync to RPC truth in case the optimistic guess was wrong
    if (data === 'followed')   setIsFollowing(true);
    if (data === 'unfollowed') setIsFollowing(false);
  }, [eventId, userId, isFollowing, toggling]);

  return { isFollowing, loading, toggling, error, toggle };
}
