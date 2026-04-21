import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FeedMode, ThemePreference, UserPreferences } from '../types';

interface UseUserPreferencesResult {
  preferences: UserPreferences | null;
  loading: boolean;
  error: string | null;
  updateTheme: (theme: ThemePreference) => Promise<void>;
  updateDefaultFeed: (feed: FeedMode) => Promise<void>;
}

/**
 * Reads and writes the current user's preferences row.
 *
 * - Fetches once on mount (or when userId changes).
 * - updateTheme / updateDefaultFeed each perform an optimistic update then
 *   upsert to the DB. On failure the optimistic update is reverted by
 *   re-fetching the DB state.
 * - Pass userId=null (unauthenticated) → preferences is null, mutations are no-ops.
 *
 * The preferences row is guaranteed to exist for every authenticated user
 * (created by handle_new_user trigger, migration 018 / 039). If for any reason
 * it is missing, the upsert in each update function will create it.
 */
export function useUserPreferences(userId: string | null): UseUserPreferencesResult {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading]         = useState(userId !== null);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      setPreferences(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          console.error('[useUserPreferences] fetch error:', fetchError.message);
          setError('Unable to load preferences');
        } else {
          setPreferences(data);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const upsertPrefs = useCallback(
    async (patch: Partial<UserPreferences>) => {
      if (!userId) return;

      const updated_at = new Date().toISOString();
      const applied = { ...patch, updated_at };

      // Optimistic update
      setPreferences(prev =>
        prev
          ? { ...prev, ...applied }
          : { user_id: userId, theme: 'system', default_home_feed: 'new', updated_at, ...patch }
      );
      setError(null);

      const { error: upsertError } = await supabase
        .from('user_preferences')
        .upsert({ user_id: userId, ...applied }, { onConflict: 'user_id' });

      if (upsertError) {
        console.error('[useUserPreferences] upsert error:', upsertError.message);
        setError('Unable to save preference');

        // Revert: re-fetch ground truth from DB
        const { data } = await supabase
          .from('user_preferences')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        setPreferences(data);
      }
    },
    [userId],
  );

  const updateTheme = useCallback(
    (theme: ThemePreference) => upsertPrefs({ theme }),
    [upsertPrefs],
  );

  const updateDefaultFeed = useCallback(
    (feed: FeedMode) => upsertPrefs({ default_home_feed: feed }),
    [upsertPrefs],
  );

  return { preferences, loading, error, updateTheme, updateDefaultFeed };
}
