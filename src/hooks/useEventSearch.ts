import { useCallback, useMemo, useState } from 'react';
import { Event } from '../types';

export interface EventSearchResult {
  query: string;
  setQuery: (q: string) => void;
  results: Event[];
  isSearching: boolean;
  clearQuery: () => void;
}

/**
 * Client-side event search: case-insensitive substring match on title.
 *
 * INTEGRATION PATH: Remove the `allEvents` parameter. Replace the useMemo
 * filter with a debounced call to:
 *   supabase.rpc('search_events', { p_query: query.trim() })
 * Add `loading: boolean` and `error: string | null` to the return shape.
 * Minimum 2-character guard is enforced by the DB function.
 */
export function useEventSearch(allEvents: Event[]): EventSearchResult {
  const [query, setQueryState] = useState('');
  const isSearching = query.trim().length > 0;

  const results = useMemo(() => {
    if (!isSearching) return allEvents;
    const q = query.trim().toLowerCase();
    return allEvents
      .filter((e) => e.title.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [allEvents, query, isSearching]);

  const setQuery = useCallback((q: string) => setQueryState(q), []);
  const clearQuery = useCallback(() => setQueryState(''), []);

  return { query, setQuery, results, isSearching, clearQuery };
}
