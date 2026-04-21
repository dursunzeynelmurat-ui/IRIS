import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
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

  // Brand accent — IRIS blue.
  iris: string;
  irisSubtle: string;

  // Semantic danger — dispute actions, errors, destructive states.
  danger: string;
  dangerSubtle: string;
}

// ── Color palettes ────────────────────────────────────────────

const LIGHT: ThemeColors = {
  bg:            '#FFFFFF',
  bgElevated:    '#FFFFFF',
  bgInput:       '#F2F4F7',
  bgOverlay:     '#EEF0F4',

  border:        '#E8EAED',
  borderStrong:  '#DADCE0',

  textPrimary:   '#1A1A2E',
  textSecondary: '#5F6368',
  textTertiary:  '#9AA0A6',

  iris:          '#1A73E8',
  irisSubtle:    '#1A73E815',

  danger:        '#C5221F',
  dangerSubtle:  '#C5221F15',
};

const DARK: ThemeColors = {
  bg:            '#0D1117',
  bgElevated:    '#161B22',
  bgInput:       '#21262D',
  bgOverlay:     '#2D333B',

  border:        '#30363D',
  borderStrong:  '#484F58',

  textPrimary:   '#E6EDF3',
  textSecondary: '#8B949E',
  textTertiary:  '#6E7681',

  iris:          '#58A6FF',
  irisSubtle:    '#58A6FF15',

  danger:        '#FF453A',
  dangerSubtle:  '#FF453A15',
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
  children: ReactNode;
  savedPreference?: ThemePreference;
  onSavePreference?: (p: ThemePreference) => Promise<void>;
}

export function ThemeProvider({ children, savedPreference, onSavePreference }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(savedPreference ?? 'system');

  useEffect(() => {
    if (savedPreference !== undefined) {
      setPreferenceState(savedPreference);
    }
  }, [savedPreference]);

  const resolved: ResolvedTheme = preference === 'system'
    ? (systemScheme === 'light' ? 'light' : 'dark')
    : preference;

  const colors = resolved === 'light' ? LIGHT : DARK;

  const setPreference = useCallback((p: ThemePreference) => {
    const previous = preference;
    setPreferenceState(p);
    if (onSavePreference) {
      onSavePreference(p).catch(() => {
        setPreferenceState(previous);
      });
    }
  }, [preference, onSavePreference]);

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
