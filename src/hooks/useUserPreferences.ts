import { useCallback, useEffect, useState } from 'react';
import { ThemePreference } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';

interface UseUserPreferencesResult {
  /**
   * The user's stored theme preference. `undefined` while loading or when
   * no preference has been saved yet — ThemeContext treats undefined as "no
   * override" and keeps its internal default ('system').
   */
  theme: ThemePreference | undefined;
  /**
   * Persists a new theme preference. Throws on failure so ThemeContext can
   * revert the optimistic local update.
   */
  updateTheme: (p: ThemePreference) => Promise<void>;
}

/**
 * Reads and writes the authenticated user's theme preference from the
 * user_preferences table.
 *
 * - Returns undefined while the row hasn't loaded yet or the user is signed out.
 * - Clears to undefined on sign-out so ThemeContext resets gracefully.
 * - Throws on write failure; ThemeContext.setPreference reverts on catch.
 * - Silently ignores fetch errors (network blip, missing row) — ThemeContext
 *   keeps its last-known preference.
 */
export function useUserPreferences(userId: string | null): UseUserPreferencesResult {
  const [theme, setTheme] = useState<ThemePreference | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      // Signed out: reset so the next user's preference loads cleanly.
      setTheme(undefined);
      return;
    }

    supabase
      .from('user_preferences')
      .select('theme')
      .eq('user_id', userId)
      .single()
      .then(({ data }) => {
        const t = data?.theme;
        if (t === 'system' || t === 'light' || t === 'dark') {
          setTheme(t);
        }
        // No row / unexpected value → leave undefined; ThemeContext uses default.
      });
  }, [userId]);

  const updateTheme = useCallback(async (p: ThemePreference) => {
    if (!userId) return;
    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, theme: p }, { onConflict: 'user_id' });
    if (error) throw error; // ThemeContext.setPreference will revert on this throw
  }, [userId]);

  return { theme, updateTheme };
}
