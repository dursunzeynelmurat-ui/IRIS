import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Event } from '../types';

interface UseEventsResult {
  events: Event[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useEvents(): UseEventsResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchEvents() {
    setLoading(true);
    setError(null);

    const { data, error: supabaseError } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });

    if (supabaseError) {
      setError(supabaseError.message);
    } else {
      setEvents(data ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchEvents();
  }, []);

  return { events, loading, error, refetch: fetchEvents };
}
