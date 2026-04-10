/**
 * Fetches ALL signals for the current user in a single query.
 *
 * Used by EventListScreen to seed each EventCard with its initial signal
 * state, eliminating the per-card N+1 query pattern.
 *
 * Returns a Map<eventId, SignalType> for O(1) card lookups, plus
 * `setSignal` to keep the map current after the user submits a vote
 * (prevents stale state if a card scrolls off-screen and remounts).
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SignalType } from '../types';

export function useUserSignals(userId: string | null): {
  signalMap: Map<string, SignalType>;
  setSignal: (eventId: string, type: SignalType) => void;
} {
  const [signalMap, setSignalMap] = useState<Map<string, SignalType>>(new Map());

  useEffect(() => {
    if (!userId) {
      setSignalMap(new Map());
      return;
    }

    let mounted = true;

    supabase
      .from('signals')
      .select('event_id, type')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error('[useUserSignals] fetch:', error);
          return;
        }
        const map = new Map<string, SignalType>();
        for (const row of data ?? []) {
          map.set(row.event_id, row.type as SignalType);
        }
        setSignalMap(map);
      });

    return () => {
      mounted = false;
    };
  }, [userId]);

  function setSignal(eventId: string, type: SignalType) {
    setSignalMap((prev) => {
      const next = new Map(prev);
      next.set(eventId, type);
      return next;
    });
  }

  return { signalMap, setSignal };
}
