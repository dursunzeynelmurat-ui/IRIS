import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FeedMode, ThemePreference } from '../types';

interface UseUserPreferencesResult {
  theme: ThemePreference | undefined;
  defaultFeed: FeedMode | undefined;
  updateTheme: (p: ThemePreference) => Promise<void>;
  updateDefaultFeed: (tab: FeedMode) => Promise<void>;
}

const VALID_THEMES    = new Set<string>(['system', 'light', 'dark']);
const VALID_FEED_TABS = new Set<string>(['new', 'verified', 'rising']);

export function useUserPreferences(userId: string | null): UseUserPreferencesResult {
  const [theme, setTheme]             = useState<ThemePreference | undefined>(undefined);
  const [defaultFeed, setDefaultFeed] = useState<FeedMode | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setTheme(undefined);
      setDefaultFeed(undefined);
      return;
    }

    let cancelled = false;

    supabase
      .from('user_preferences')
      .select('theme, default_home_feed')
      .eq('user_id', userId)
      .single()
      .then(({ data }) => {
        if (cancelled) return;
        const t = data?.theme;
        if (t && VALID_THEMES.has(t)) setTheme(t as ThemePreference);

        const f = data?.default_home_feed;
        if (f && VALID_FEED_TABS.has(f)) setDefaultFeed(f as FeedMode);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const updateTheme = useCallback(async (p: ThemePreference) => {
    if (!userId) return;
    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, theme: p }, { onConflict: 'user_id' });
    if (error) throw error;
  }, [userId]);

  const updateDefaultFeed = useCallback(async (tab: FeedMode) => {
    if (!userId) return;
    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, default_home_feed: tab }, { onConflict: 'user_id' });
    if (error) throw error;
  }, [userId]);

  return { theme, defaultFeed, updateTheme, updateDefaultFeed };
}
