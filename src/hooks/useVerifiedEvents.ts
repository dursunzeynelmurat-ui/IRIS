import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Event } from '../types';

export interface VerifiedEventsResult {
  events: Event[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Backend-filtered verified events.
 *
 * Queries events WHERE status = 'verified' at the DB level — the Verified tab
 * does not pull the full event list and filter locally. Ordered by most recent
 * activity (latest_update_at DESC NULLS LAST, then created_at DESC).
 *
 * Realtime subscription patches the list as events change status:
 *   - Newly verified events are prepended.
 *   - Events that leave verified status are removed.
 *   - Trust score / source count updates are patched in place.
 */
export function useVerifiedEvents(): VerifiedEventsResult {
  const [events, setEvents]         = useState<Event[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const initialLoad                 = useRef(true);

  async function fetchVerified() {
    if (initialLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    const { data, error: dbError } = await supabase
      .from('events')
      .select('*')
      .eq('status', 'verified')
      .order('latest_update_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (dbError) {
      console.error('[useVerifiedEvents]', dbError);
      setError('Unable to load verified events.');
    } else {
      setEvents((data as Event[]) ?? []);
    }

    setLoading(false);
    setRefreshing(false);
    initialLoad.current = false;
  }

  useEffect(() => {
    fetchVerified();

    const channel = supabase
      .channel('verified-events-feed')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        (payload) => {
          const incoming = payload.new;
          if (!incoming || typeof incoming !== 'object' || !('id' in incoming)) return;
          const updated = incoming as Event;
          if (updated.status === 'verified') {
            setEvents((prev) => {
              const idx = prev.findIndex((e) => e.id === updated.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], ...updated };
                return next;
              }
              return [updated, ...prev]; // event became verified
            });
          } else {
            setEvents((prev) => prev.filter((e) => e.id !== updated.id));
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          const incoming = payload.new;
          if (!incoming || typeof incoming !== 'object' || !('id' in incoming)) return;
          const newEvent = incoming as Event;
          if (newEvent.status !== 'verified') return;
          setEvents((prev) => {
            if (prev.some((e) => e.id === newEvent.id)) return prev;
            return [newEvent, ...prev];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { events, loading, refreshing, error, refetch: fetchVerified };
}
