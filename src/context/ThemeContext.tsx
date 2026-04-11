import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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

  // Brand
  iris: string;
  irisSubtle: string; // low-opacity bg tint for iris accent

  // Navigation / header
  navBg: string;
  navText: string;
  navBorder: string;
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

  navBg:         '#0d0d0d',
  navText:       '#f2f2f2',
  navBorder:     '#2c2c2e',
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

  navBg:         '#ffffff',
  navText:       '#0d0d0d',
  navBorder:     '#c6c6c8',
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [preference, setPreference] = useState<ThemePreference>('system');

  const resolved: ResolvedTheme = useMemo(() => {
    if (preference === 'light') return 'light';
    if (preference === 'dark') return 'dark';
    return systemScheme === 'light' ? 'light' : 'dark';
  }, [preference, systemScheme]);

  const colors = resolved === 'light' ? LIGHT : DARK;

  const handleSetPreference = useCallback((p: ThemePreference) => {
    setPreference(p);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, colors, setPreference: handleSetPreference }),
    [preference, resolved, colors, handleSetPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
