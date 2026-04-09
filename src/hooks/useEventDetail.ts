import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Event, EventUpdate } from '../types';

interface UseEventDetailResult {
  event: Event | null;
  updates: EventUpdate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEventDetail(eventId: string): UseEventDetailResult {
  const [event, setEvent] = useState<Event | null>(null);
  const [updates, setUpdates] = useState<EventUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchDetail() {
    setLoading(true);
    setError(null);

    const [eventResult, updatesResult] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase
        .from('event_updates')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true }),
    ]);

    if (eventResult.error) {
      console.error('[useEventDetail] event fetch:', eventResult.error);
      setError('Unable to load event. Please try again.');
      setLoading(false);
      return;
    }

    if (updatesResult.error) {
      console.error('[useEventDetail] updates fetch:', updatesResult.error);
      setError('Unable to load event updates. Please try again.');
      setLoading(false);
      return;
    }

    setEvent(eventResult.data);
    setUpdates(updatesResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchDetail();

    // Channel 1: patch event fields (trust_score etc.) on UPDATE
    const eventChannel = supabase
      .channel(`event-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` },
        (payload) => {
          setEvent((prev) => (prev ? { ...prev, ...(payload.new as Event) } : prev));
        },
      )
      .subscribe();

    // Channel 2: append new timeline entries on INSERT, deduplicated by id
    const updatesChannel = supabase
      .channel(`event-updates-${eventId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'event_updates', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const incoming = payload.new as EventUpdate;
          setUpdates((prev) => {
            // Guard: don't add if already present (e.g. overlap with a refetch)
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

  return { event, updates, loading, error, refetch: fetchDetail };
}
