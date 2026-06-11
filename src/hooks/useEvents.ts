import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Event } from '../types';

/** Mirrors the get_feed_events('new') WHERE clause for realtime payloads. */
function isFeedEligible(e: Event): boolean {
  return (
    e.visibility === 'visible' &&
    e.status !== 'archived' &&
    e.status !== 'resolved' &&
    e.status !== 'contained'
  );
}

interface UseEventsResult {
  events: Event[];
  loading: boolean;      // true only on the initial fetch (shows full-screen spinner)
  refreshing: boolean;   // true on pull-to-refresh (shows FlatList spinner)
  error: string | null;
  refetch: () => void;
}

export function useEvents(): UseEventsResult {
  const [events, setEvents]       = useState<Event[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const initialLoad               = useRef(true);

  async function fetchEvents() {
    if (initialLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    // Mirrors get_feed_events('new') semantics: visible, non-terminal events only.
    const { data, error: dbError } = await supabase
      .from('events')
      .select('*')
      .eq('visibility', 'visible')
      .not('status', 'in', '(archived,resolved,contained)')
      .order('latest_update_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (dbError) {
      if (__DEV__) console.error('[useEvents]', dbError);
      setError('Unable to load events. Please try again.');
    } else {
      setEvents(data ?? []);
    }

    setLoading(false);
    setRefreshing(false);
    initialLoad.current = false;
  }

  useEffect(() => {
    fetchEvents();

    const channel = supabase
      .channel('events-feed')
      // Patch existing events (trust_score, status changes); drop events that
      // leave the feed (hidden or moved to a terminal status)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events' },
        (payload) => {
          const incoming = payload.new;
          if (!incoming || typeof incoming !== 'object' || !('id' in incoming)) return;
          const updated = incoming as Event;
          if (!isFeedEligible(updated)) {
            setEvents((prev) => prev.filter((e) => e.id !== updated.id));
            return;
          }
          setEvents((prev) =>
            prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)),
          );
        },
      )
      // Prepend new events as they arrive from the ingestion script
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          const incoming = payload.new;
          if (!incoming || typeof incoming !== 'object' || !('id' in incoming)) return;
          const newEvent = incoming as Event;
          if (!isFeedEligible(newEvent)) return;
          setEvents((prev) => {
            if (prev.some((e) => e.id === newEvent.id)) return prev; // dedup guard
            return [newEvent, ...prev]; // list is newest-first
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { events, loading, refreshing, error, refetch: fetchEvents };
}
