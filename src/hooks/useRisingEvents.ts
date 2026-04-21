import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Event } from '../types';

export interface RisingEventsResult {
  events: Event[];
  loading: boolean;     // true only on the initial fetch (full-tab spinner)
  refreshing: boolean;  // true during pull-to-refresh (FlatList spinner)
  error: string | null;
  refetch: () => void;
}

/**
 * Backend-driven rising events via the get_rising_events RPC.
 *
 * Ranking (server-side): feed_rank composite (trust, importance, recency, engagement).
 * Only 'new' + 'developing' events are included.
 */
export function useRisingEvents(): RisingEventsResult {
  const [events, setEvents]         = useState<Event[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const initialLoad                 = useRef(true);

  const fetchRising = useCallback(async () => {
    if (initialLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('get_rising_events', {
      p_limit: 100,
    });

    if (rpcError) {
      setError('Unable to load rising events.');
      // Keep stale events visible on refresh failure; clear only on initial load.
      if (initialLoad.current) setEvents([]);
    } else {
      setEvents((data as Event[]) ?? []);
    }

    setLoading(false);
    setRefreshing(false);
    initialLoad.current = false;
  }, []);

  useEffect(() => {
    fetchRising();
  }, [fetchRising]);

  return { events, loading, refreshing, error, refetch: fetchRising };
}
