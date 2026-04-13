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
 * Rising is scored server-side:
 *   follow_count × 10 + status_bonus + trust_score / 10
 *
 * The server formula means the Rising tab reflects real engagement
 * (source coverage, user signals, follows) rather than a client-side heuristic.
 *
 * On pull-to-refresh, stale data is kept visible until the new response
 * arrives so the tab never flashes empty.
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
