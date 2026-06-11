import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event, EventUpdate } from '../types';

interface UseEventDetailResult {
  event: Event | null;
  updates: EventUpdate[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  updatesError: string | null;
  refetch: () => void;
}

export function useEventDetail(eventId: string): UseEventDetailResult {
  const [event, setEvent]               = useState<Event | null>(null);
  const [updates, setUpdates]           = useState<EventUpdate[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const initialLoad                     = useRef(true);

  async function fetchDetail() {
    if (initialLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    setUpdatesError(null);

    const [eventResult, updatesResult] = await Promise.all([
      supabase.rpc('get_event_detail', { p_event_id: eventId }),
      supabase.rpc('get_event_updates_for_detail', { p_event_id: eventId }),
    ]);

    if (eventResult.error) {
      if (__DEV__) console.error('[useEventDetail] event fetch:', eventResult.error);
      setError('Unable to load event. Please try again.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // get_event_detail is RETURNS TABLE — PostgREST returns an array of rows.
    const eventRow = ((eventResult.data as Event[] | null) ?? [])[0] ?? null;
    if (!eventRow) {
      setError('Event not found.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setEvent(eventRow);

    if (updatesResult.error) {
      if (__DEV__) console.error('[useEventDetail] updates fetch:', updatesResult.error);
      setUpdatesError('Unable to load updates. Pull down to retry.');
      if (initialLoad.current) setUpdates([]);
    } else {
      setUpdates(updatesResult.data ?? []);
    }

    setLoading(false);
    setRefreshing(false);
    initialLoad.current = false;
  }

  useEffect(() => {
    initialLoad.current = true;
    fetchDetail();

    const eventChannel = supabase
      .channel(`event-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        (payload) => {
          const incoming = payload.new;
          if (
            !incoming ||
            typeof incoming !== 'object' ||
            typeof (incoming as { id?: unknown }).id !== 'string'
          ) return;
          setEvent((prev) => (prev ? { ...prev, ...(incoming as Event) } : prev));
        },
      )
      .subscribe();

    const updatesChannel = supabase
      .channel(`event-updates-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'event_updates', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const raw = payload.new;
          if (
            !raw ||
            typeof raw !== 'object' ||
            typeof (raw as { id?: unknown }).id !== 'string'
          ) return;
          const incoming = raw as EventUpdate;
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

  return { event, updates, loading, refreshing, error, updatesError, refetch: fetchDetail };
}
