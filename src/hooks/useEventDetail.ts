import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event, EventUpdate } from '../types';

interface UseEventDetailResult {
  event: Event | null;
  updates: EventUpdate[];
  loading: boolean;     // true only on the initial fetch
  refreshing: boolean;  // true on pull-to-refresh (mirrors useEvents pattern)
  error: string | null;
  refetch: () => void;
}

export function useEventDetail(eventId: string): UseEventDetailResult {
  const [event, setEvent]           = useState<Event | null>(null);
  const [updates, setUpdates]       = useState<EventUpdate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const initialLoad                 = useRef(true);

  async function fetchDetail() {
    if (initialLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    const [eventResult, updatesResult] = await Promise.all([
      supabase.rpc('get_event_detail', { p_event_id: eventId }),
      supabase.rpc('get_event_updates_for_detail', { p_event_id: eventId }),
    ]);

    if (eventResult.error) {
      console.error('[useEventDetail] event fetch:', eventResult.error);
      setError('Unable to load event. Please try again.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (updatesResult.error) {
      console.error('[useEventDetail] updates fetch:', updatesResult.error);
      setError('Unable to load event updates. Please try again.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setEvent((eventResult.data as Event) ?? null);
    setUpdates((updatesResult.data as EventUpdate[]) ?? []);
    setLoading(false);
    setRefreshing(false);
    initialLoad.current = false;
  }

  useEffect(() => {
    // Reset initial-load flag so navigating to a new event shows the full spinner.
    initialLoad.current = true;
    fetchDetail();

    // Channel 1: patch event fields (trust_score etc.) on UPDATE
    const eventChannel = supabase
      .channel(`event-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        (payload) => {
          const incoming = payload.new;
          if (!incoming || typeof incoming !== 'object' || !('id' in incoming)) return;
          setEvent((prev) => (prev ? { ...prev, ...(incoming as Partial<Event>) } : prev));
        },
      )
      .subscribe();

    // Channel 2: append new timeline entries on INSERT, filtering hidden updates
    const updatesChannel = supabase
      .channel(`event-updates-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'event_updates', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const raw = payload.new;
          if (!raw || typeof raw !== 'object' || !('id' in raw)) return;
          const incoming = raw as EventUpdate;
          // Only surface updates that are visible in the product timeline
          if (!incoming.is_visible) return;
          setUpdates((prev) => {
            if (prev.some((u) => u.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(eventChannel);
      supabase.removeChannel(updatesChannel);
    };
  }, [eventId]);

  return { event, updates, loading, refreshing, error, refetch: fetchDetail };
}
