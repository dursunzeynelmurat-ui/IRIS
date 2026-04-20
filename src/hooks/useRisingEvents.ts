import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../types';

interface UseRisingEventsResult {
  events: Event[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches the Rising feed via the get_rising_events RPC.
 *
 * Ranking (server-side): feed_rank composite (trust, importance, recency, engagement).
 * Only 'new' + 'developing' events are included.
 */
export function useRisingEvents(limit = 20): UseRisingEventsResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .rpc('get_rising_events', { p_limit: limit })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
        } else {
          setEvents((data as Event[]) ?? []);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [limit, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  return { events, loading, error, refetch };
}
