import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Event } from '../types';

interface UseSearchResult {
  results: Event[];
  searching: boolean;
  error: string | null;
  query: string;
  setQuery: (q: string) => void;
  clearResults: () => void;
}

/**
 * Debounced event search via the search_events RPC (migration 021).
 *
 * - Fires when query length ≥ 2 (server enforces the same minimum)
 * - Clears results immediately when query drops below 2 chars
 * - Debounce window: debounceMs (default 300 ms)
 * - Outstanding requests are cancelled when a new query is set
 */
export function useSearch(debounceMs = 300): UseSearchResult {
  const [query, setQueryState] = useState('');
  const [results, setResults]  = useState<Event[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    // Clear any pending debounce
    if (timerRef.current) clearTimeout(timerRef.current);
    cancelledRef.current = true; // cancel any in-flight fetch from prior query

    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    cancelledRef.current = false;

    timerRef.current = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('search_events', {
        p_query: query.trim(),
      });

      if (cancelledRef.current) return;

      if (err) {
        setError(err.message);
        setResults([]);
      } else {
        setResults((data as Event[]) ?? []);
        setError(null);
      }
      setSearching(false);
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      cancelledRef.current = true;
    };
  }, [query, debounceMs]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
  }, []);

  const clearResults = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    cancelledRef.current = true;
    setQueryState('');
    setResults([]);
    setSearching(false);
    setError(null);
  }, []);

  return { results, searching, error, query, setQuery, clearResults };
}
