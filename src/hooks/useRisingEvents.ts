import { useMemo } from 'react';
import { Event } from '../types';

export interface RisingEventsResult {
  events: Event[];
}

/**
 * Emerging and developing stories sorted by trust_score DESC.
 *
 * INTEGRATION PATH: Remove the `allEvents` parameter. Replace the useMemo
 * with a call to:
 *   supabase.rpc('get_rising_events', { p_limit: 100 })
 * Add `loading: boolean`, `error: string | null`, and `refetch: () => void`
 * to the return shape.
 */
export function useRisingEvents(allEvents: Event[]): RisingEventsResult {
  const events = useMemo(
    () =>
      allEvents
        .filter((e) => e.status === 'emerging' || e.status === 'developing')
        .sort((a, b) => (b.trust_score ?? 0) - (a.trust_score ?? 0)),
    [allEvents],
  );

  return { events };
}
