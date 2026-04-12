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
 *
 * Cancellation uses a local closure variable per effect invocation rather than
 * a shared ref. A shared ref has a race: the new effect run resets it to false
 * before the previous in-flight fetch completes, so the stale response can
 * still update state. A local variable is scoped to the exact closure captured
 * by the timeout callback — it cannot be reset by a concurrent invocation.
 */
export function useSearch(debounceMs = 300): UseSearchResult {
  const [query, setQueryState] = useState('');
  const [results, setResults]  = useState<Event[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    // Local var — unique to this effect invocation. The cleanup below sets it
    // true when the component re-renders or unmounts, which covers both:
    //   a) timeout not yet fired → clearTimeout prevents execution
    //   b) timeout fired, fetch in flight → cancelled=true discards the response
    let cancelled = false;

    timerRef.current = setTimeout(async () => {
      const { data, error: err } = await supabase.rpc('search_events', {
        p_query: query.trim(),
      });

      if (cancelled) return;

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
      cancelled = true;
    };
  }, [query, debounceMs]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
  }, []);

  const clearResults = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Changing query to '' triggers the effect which calls the cleanup above,
    // setting cancelled=true on any in-flight fetch from the previous query.
    setQueryState('');
    setResults([]);
    setSearching(false);
    setError(null);
  }, []);

  return { results, searching, error, query, setQuery, clearResults };
}
