import { useCallback, useEffect, useState } from 'react';
import { ThemePreference } from '../context/ThemeContext';
import { FeedTab } from '../types';
import { supabase } from '../lib/supabase';

interface UseUserPreferencesResult {
  /** Stored theme preference; undefined while loading or when no row exists. */
  theme: ThemePreference | undefined;
  /** Stored default feed tab; undefined while loading or when no row exists. */
  defaultFeed: FeedTab | undefined;
  /** Persists theme; throws on failure so ThemeContext can revert optimistically. */
  updateTheme: (p: ThemePreference) => Promise<void>;
  /** Persists default feed; throws on failure so FeedPreferenceContext can revert. */
  updateDefaultFeed: (tab: FeedTab) => Promise<void>;
}

const VALID_THEMES    = new Set<string>(['system', 'light', 'dark']);
const VALID_FEED_TABS = new Set<string>(['new', 'verified', 'rising']);

export function useUserPreferences(userId: string | null): UseUserPreferencesResult {
  const [theme, setTheme]             = useState<ThemePreference | undefined>(undefined);
  const [defaultFeed, setDefaultFeed] = useState<FeedTab | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setTheme(undefined);
      setDefaultFeed(undefined);
      return;
    }

    supabase
      .from('user_preferences')
      .select('theme, default_feed')
      .eq('user_id', userId)
      .single()
      .then(({ data }) => {
        const t = data?.theme;
        if (t && VALID_THEMES.has(t)) setTheme(t as ThemePreference);

        const f = data?.default_feed;
        if (f && VALID_FEED_TABS.has(f)) setDefaultFeed(f as FeedTab);
        // No row or unexpected values → leave undefined; contexts use their defaults.
      });
  }, [userId]);

  const updateTheme = useCallback(async (p: ThemePreference) => {
    if (!userId) return;
    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, theme: p }, { onConflict: 'user_id' });
    if (error) throw error; // ThemeContext will revert on this throw
  }, [userId]);

  const updateDefaultFeed = useCallback(async (tab: FeedTab) => {
    if (!userId) return;
    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, default_feed: tab }, { onConflict: 'user_id' });
    if (error) throw error; // FeedPreferenceContext will revert on this throw
  }, [userId]);

  return { theme, defaultFeed, updateTheme, updateDefaultFeed };
}
