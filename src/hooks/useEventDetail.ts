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
      supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single(),
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

  useEffect(() => {
    fetchDetail();
  }, [eventId]);

  return { event, updates, loading, error, refetch: fetchDetail };
}
