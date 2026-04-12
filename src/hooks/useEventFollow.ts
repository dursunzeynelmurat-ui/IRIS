import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface UseEventFollowResult {
  /** null = loading, true/false = resolved */
  isFollowing: boolean | null;
  /** initial data fetch in progress */
  loading: boolean;
  /** toggle request in flight */
  toggling: boolean;
  error: string | null;
  toggle: () => Promise<void>;
}

/**
 * Manages the follow state for a single event + user pair.
 *
 * - Fetches current follow state on mount (skips if userId is null)
 * - Optimistic toggle: updates UI immediately, reverts on failure
 * - INSERT on follow, DELETE on unfollow
 */
export function useEventFollow(
  eventId: string,
  userId: string | null,
): UseEventFollowResult {
  // Start loading=true only when userId is already known to avoid a flash
  const [loading, setLoading]       = useState(userId !== null);
  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [toggling, setToggling]     = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const cancelledRef                = useRef(false);

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

  const toggle = useCallback(async () => {
    if (!userId || toggling) return;

    const wasFollowing = isFollowing ?? false;
    const nextFollowing = !wasFollowing;

    // Optimistic update
    setIsFollowing(nextFollowing);
    setToggling(true);
    setError(null);

    try {
      if (nextFollowing) {
        const { error: err } = await supabase
          .from('event_follows')
          .insert({ user_id: userId, event_id: eventId });
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('event_follows')
          .delete()
          .eq('user_id', userId)
          .eq('event_id', eventId);
        if (err) throw err;
      }
    } catch (err: unknown) {
      // Revert optimistic update
      setIsFollowing(wasFollowing);
      setError(err instanceof Error ? err.message : 'Failed to update follow');
    } finally {
      setToggling(false);
    }
  }, [eventId, userId, isFollowing, toggling]);

  return { isFollowing, loading, toggling, error, toggle };
}
