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
      setError(eventResult.error.message);
      setLoading(false);
      return;
    }

    if (updatesResult.error) {
      setError(updatesResult.error.message);
      setLoading(false);
      return;
    }

    setEvent(eventResult.data);
    setUpdates(updatesResult.data ?? []);
    setLoading(false);
  }

  // Step 7 — Realtime subscriptions
  useEffect(() => {
    fetchDetail();

    // Channel 1: listen for trust_score (and any field) changes on this event row
    const eventChannel = supabase
      .channel(`event-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'events',
          filter: `id=eq.${eventId}`,
        },
        (payload) => {
          setEvent((prev) => (prev ? { ...prev, ...(payload.new as Event) } : prev));
        },
      )
      .subscribe();

    // Channel 2: listen for new event_updates (timeline entries)
    const updatesChannel = supabase
      .channel(`event-updates-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_updates',
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          setUpdates((prev) => [...prev, payload.new as EventUpdate]);
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
