import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Event } from '../types';

/** Minimum characters before issuing a backend search request. Mirrors the DB guard. */
export const MIN_QUERY_LEN = 2;

/** Debounce window — avoids a round trip on every keystroke. */
const DEBOUNCE_MS = 300;

export interface EventSearchResult {
  query: string;
  setQuery: (q: string) => void;
  results: Event[];
  /** True when any query text is present — drives search bar UX regardless of length. */
  isSearching: boolean;
  /** True while a debounced RPC call is in-flight. */
  loading: boolean;
  error: string | null;
  clearQuery: () => void;
}

/**
 * Backend-driven event search via the search_events RPC.
 *
 * Queries ≥ MIN_QUERY_LEN characters are debounced (300 ms) then sent to
 * supabase.rpc('search_events', { p_query }). Shorter queries immediately
 * clear results without a network call.
 *
 * Stale responses from superseded queries are silently discarded via a
 * monotonic request counter, so rapid typing never causes result flicker.
 */
export function useEventSearch(): EventSearchResult {
  const [query, setQueryState] = useState('');
  const [results, setResults]   = useState<Event[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Monotonic counter: each effect run increments it; the async callback
  // checks whether it still matches before committing state.
  const requestCount = useRef(0);

  const trimmed = query.trim();
  const isSearching = trimmed.length > 0;

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LEN) {
      // Too short — clear immediately, no RPC needed.
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Signal loading so the UI can respond before the debounce fires.
    setLoading(true);
    setError(null);

    const thisRequest = ++requestCount.current;

    const timerId = setTimeout(async () => {
      const { data, error: rpcError } = await supabase.rpc('search_events', {
        p_query: trimmed,
      });

      // Drop response if a newer query has already started.
      if (thisRequest !== requestCount.current) return;

      if (rpcError) {
        setError('Search unavailable. Try again.');
        setResults([]);
      } else {
        setResults((data as Event[]) ?? []);
      }
      setLoading(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timerId);
  }, [trimmed]);

  const setQuery = useCallback((q: string) => setQueryState(q), []);

  const clearQuery = useCallback(() => {
    requestCount.current++; // invalidate any in-flight request
    setQueryState('');
    setResults([]);
    setLoading(false);
    setError(null);
  }, []);

  return { query, setQuery, results, isSearching, loading, error, clearQuery };
}
