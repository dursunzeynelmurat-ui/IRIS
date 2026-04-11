import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ThemePreference, UserPreferences } from '../types';

interface UseUserPreferencesResult {
  preferences: UserPreferences | null;
  loading: boolean;
  error: string | null;
  updateTheme: (theme: ThemePreference) => Promise<void>;
}

/**
 * Reads and writes the current user's preferences row.
 *
 * - Fetches once on mount (or when userId changes).
 * - updateTheme performs an optimistic update then upserts to the DB.
 *   On failure the optimistic update is reverted by re-fetching the DB state.
 * - Pass userId=null (unauthenticated) → preferences is null, updateTheme is a no-op.
 *
 * The preferences row is guaranteed to exist for every authenticated user
 * (created by handle_new_user trigger, migration 018). If for any reason it
 * is missing, updateTheme will create it via upsert.
 */
export function useUserPreferences(userId: string | null): UseUserPreferencesResult {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const updateTheme = useCallback(
    async (theme: ThemePreference) => {
      if (!userId) return;

      const updated_at = new Date().toISOString();

      // Optimistic update
      setPreferences(prev =>
        prev
          ? { ...prev, theme, updated_at }
          : { user_id: userId, theme, updated_at }
      );
      setError(null);

      const { error: upsertError } = await supabase
        .from('user_preferences')
        .upsert({ user_id: userId, theme, updated_at }, { onConflict: 'user_id' });

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
    [userId]
  );

  return { preferences, loading, error, updateTheme };
}
