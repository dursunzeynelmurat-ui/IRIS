/**
 * ThemeContext — single source of truth for the resolved UI theme.
 *
 * ThemeProvider takes a userId and internally reads the user's persisted
 * preference from user_preferences via useUserPreferences. It resolves that
 * preference to a concrete scheme ('light' | 'dark') and exposes the full
 * color token set for the app's design system.
 *
 * ThemeProvider must be rendered inside AuthProvider and only when the user
 * is authenticated (userId is a string, not null). See AuthedApp in App.tsx.
 *
 * Context shape:
 *   preference   — stored value: 'system' | 'light' | 'dark'
 *   resolved     — actual scheme in use after resolving 'system'
 *   colors       — full design-system token set for the resolved scheme
 *   setPreference — persists + applies a new preference (optimistic)
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useUserPreferences } from '../hooks/useUserPreferences';
import type { ThemePreference } from '../types';

// Re-export for screens that import ThemePreference from this module.
export type { ThemePreference };

export type ResolvedTheme = 'light' | 'dark';

// ── Color token interface ─────────────────────────────────────

export interface ThemeColors {
  // Backgrounds
  bg: string;
  bgElevated: string;
  bgInput: string;
  bgOverlay: string;

  // Borders
  border: string;
  borderStrong: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  // Brand accent — IRIS red.
  // Single source of truth for brand expression across all themes.
  iris: string;
  irisSubtle: string;
}

// ── Color palettes ────────────────────────────────────────────

const DARK: ThemeColors = {
  bg:            '#0d0d0d',
  bgElevated:    '#1c1c1e',
  bgInput:       '#1c1c1e',
  bgOverlay:     '#2c2c2e',

  border:        '#2c2c2e',
  borderStrong:  '#3a3a3c',

  textPrimary:   '#f2f2f2',
  textSecondary: '#8e8e93',
  textTertiary:  '#636366',

  iris:          '#e5193e',
  irisSubtle:    '#e5193e22',
};

const LIGHT: ThemeColors = {
  bg:            '#f2f2f7',
  bgElevated:    '#ffffff',
  bgInput:       '#ffffff',
  bgOverlay:     '#e5e5ea',

  border:        '#c6c6c8',
  borderStrong:  '#aeaeb2',

  textPrimary:   '#0d0d0d',
  textSecondary: '#48484a',
  textTertiary:  '#8e8e93',

  iris:          '#c90f2e',
  irisSubtle:    '#c90f2e18',
};

// ── Context ───────────────────────────────────────────────────

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  colors: ThemeColors;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  preference:    'system',
  resolved:      'dark',
  colors:        DARK,
  setPreference: () => {},
});

// ── Provider ──────────────────────────────────────────────────

interface ThemeProviderProps {
  /** Authenticated user ID. ThemeProvider is only mounted when userId is known. */
  userId: string;
  children: ReactNode;
}

/**
 * ThemeProvider wires three concerns together:
 *
 *   1. Backend persistence  — useUserPreferences reads/writes user_preferences
 *   2. System scheme        — useColorScheme() resolves 'system' to light|dark
 *   3. Design tokens        — DARK/LIGHT palettes map resolved scheme to colors
 *
 * setPreference delegates to updateTheme, which is optimistic inside
 * useUserPreferences: the change is applied immediately in the hook's state
 * and re-fetched from the DB on failure, reverting automatically.
 */
export function ThemeProvider({ userId, children }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const { preferences, updateTheme } = useUserPreferences(userId);

  // Derive preference from backend state; default to 'system' while loading.
  const preference: ThemePreference = preferences?.theme ?? 'system';

  const resolved: ResolvedTheme = preference === 'system'
    ? (systemScheme === 'light' ? 'light' : 'dark')
    : preference;

  // LIGHT and DARK are module-level constants — stable references.
  const colors = resolved === 'light' ? LIGHT : DARK;

  // setPreference is fire-and-forget from the caller's perspective.
  // updateTheme handles optimism and DB-revert internally.
  const setPreference = useCallback((p: ThemePreference) => {
    updateTheme(p).catch((err: unknown) => {
      console.warn('[ThemeContext] setPreference failed:', err);
    });
  }, [updateTheme]);

  const value = useMemo(
    () => ({ preference, resolved, colors, setPreference }),
    [preference, resolved, colors, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
