/**
 * ThemeContext — single source of truth for the resolved UI theme.
 *
 * ThemeProvider reads the user's stored preference via useUserPreferences and
 * resolves it to an actual scheme:
 *
 *   'system' → follows the device's color scheme (useColorScheme())
 *   'light'  → always light, regardless of device setting
 *   'dark'   → always dark, regardless of device setting
 *
 * Falls back to 'dark' when device scheme is unavailable (Expo Go, SSR, etc.)
 * since the app was originally designed dark-first.
 *
 * Provides:
 *   preference     — stored value: 'system' | 'light' | 'dark'
 *   resolvedScheme — actual scheme in use: 'light' | 'dark'
 *   navTheme       — React Navigation Theme object for <NavigationContainer>
 *   updateTheme    — writes new preference to user_preferences (optimistic)
 *   loading        — true while the initial preferences fetch is in-flight
 *
 * ThemeProvider must be rendered inside AuthProvider (it needs a resolved userId).
 * It must wrap any component that calls useTheme().
 */

import { createContext, ReactNode, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { DarkTheme, DefaultTheme, Theme } from '@react-navigation/native';
import { useUserPreferences } from '../hooks/useUserPreferences';
import type { ThemePreference } from '../types';

interface ThemeContextValue {
  /** The stored preference value, as written to user_preferences.theme. */
  preference: ThemePreference;
  /** The actual scheme after resolving 'system'. Safe to use for style decisions. */
  resolvedScheme: 'light' | 'dark';
  /** Pre-built React Navigation theme object — pass directly to NavigationContainer. */
  navTheme: Theme;
  /** Upserts a new theme preference. Optimistic; reverts on failure. */
  updateTheme: (theme: ThemePreference) => Promise<void>;
  /** True while the initial preferences row fetch is in-flight. */
  loading: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'system',
  resolvedScheme: 'dark',
  navTheme: DarkTheme,
  updateTheme: async () => {},
  loading: false,
});

interface ThemeProviderProps {
  userId: string;
  children: ReactNode;
}

export function ThemeProvider({ userId, children }: ThemeProviderProps) {
  // Device color scheme — may be null/undefined in Expo Go or server environments.
  const systemScheme = useColorScheme();
  const { preferences, loading, updateTheme } = useUserPreferences(userId);

  const preference: ThemePreference = preferences?.theme ?? 'system';

  // Resolve 'system' to an actual scheme. Fall back to 'dark' (app default)
  // when the device scheme is unknown.
  const resolvedScheme: 'light' | 'dark' =
    preference === 'system'
      ? (systemScheme ?? 'dark')
      : preference;

  const navTheme: Theme = resolvedScheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <ThemeContext.Provider value={{ preference, resolvedScheme, navTheme, updateTheme, loading }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Consume the resolved theme anywhere inside a ThemeProvider. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
