/**
 * useSearch — full-text search over events and event_updates.
 *
 * Calls search_events() and search_event_updates() RPCs (migration 021).
 * Both run as SECURITY INVOKER so the caller's RLS context applies.
 *
 * DEBOUNCE:
 *   Searches fire after a 300 ms debounce to avoid hammering the DB on
 *   every keystroke. Cancels in-flight fetches when query changes.
 *
 * CLEARING:
 *   Call clear() or set query to '' to reset results without a DB round-trip.
 *
 * SCOPE:
 *   Returns events and event_updates in separate arrays. The caller decides
 *   how to display them (e.g. grouped sections, merged list, etc.).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event, EventUpdate } from '../types';

interface UseSearchResult {
  events: Event[];
  updates: EventUpdate[];
  loading: boolean;
  error: string | null;
  clear: () => void;
}

const DEBOUNCE_MS = 300;

export function useSearch(query: string): UseSearchResult {
  const [events, setEvents]   = useState<Event[]>([]);
  const [updates, setUpdates] = useState<EventUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef(false);

  const clear = useCallback(() => {
    setEvents([]);
    setUpdates([]);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      clear();
      return;
    }

    // Debounce
    if (timerRef.current) clearTimeout(timerRef.current);
    cancelRef.current = false;

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);

      const [eventsResult, updatesResult] = await Promise.all([
        supabase.rpc('search_events', { query: trimmed }),
        supabase.rpc('search_event_updates', { query: trimmed }),
      ]);

      if (cancelRef.current) return;

      if (eventsResult.error || updatesResult.error) {
        setError('Search failed. Please try again.');
        setEvents([]);
        setUpdates([]);
      } else {
        setEvents((eventsResult.data as Event[]) ?? []);
        setUpdates((updatesResult.data as EventUpdate[]) ?? []);
      }

      setLoading(false);
    }, DEBOUNCE_MS);

    return () => {
      cancelRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, clear]);

  return { events, updates, loading, error, clear };
}
