import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

// ── Types ─────────────────────────────────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

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
  // The color tokens here are the single source of truth for brand expression.
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

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────

interface ThemeProviderProps {
  children: ReactNode;
  /**
   * Backend-persisted preference. When provided, the provider syncs to it on
   * mount and whenever it changes (e.g. after a successful preferences fetch).
   *
   * Integration: pass `userPrefs?.theme` from a useUserPreferences() hook.
   */
  savedPreference?: ThemePreference;
  /**
   * Called whenever the user selects a new preference. The provider applies
   * the change optimistically and reverts on failure.
   *
   * Integration: pass `updateTheme` from a useUserPreferences() hook.
   */
  onSavePreference?: (p: ThemePreference) => Promise<void>;
}

export function ThemeProvider({ children, savedPreference, onSavePreference }: ThemeProviderProps) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [preference, setPreferenceState] = useState<ThemePreference>(savedPreference ?? 'system');

  // Sync to backend-loaded preference whenever it arrives or changes.
  useEffect(() => {
    if (savedPreference !== undefined) {
      setPreferenceState(savedPreference);
    }
  }, [savedPreference]);

  const resolved: ResolvedTheme = useMemo(() => {
    if (preference === 'light') return 'light';
    if (preference === 'dark') return 'dark';
    return systemScheme === 'light' ? 'light' : 'dark';
  }, [preference, systemScheme]);

  // LIGHT and DARK are module-level constants (stable references).
  // colors reference is therefore stable unless resolved changes.
  const colors = resolved === 'light' ? LIGHT : DARK;

  const setPreference = useCallback((p: ThemePreference) => {
    const previous = preference;
    setPreferenceState(p);
    if (onSavePreference) {
      // Optimistic update — revert on backend failure.
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
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
