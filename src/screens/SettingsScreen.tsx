import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import type { ThemePreference } from '../types';

// ── Theme options ──────────────────────────────────────────────

const THEME_OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Follows your device setting' },
  { value: 'light',  label: 'Light',  description: 'Always light'                },
  { value: 'dark',   label: 'Dark',   description: 'Always dark'                 },
];

// ── Screen ──────────────────────────────────────────────────────

export function SettingsScreen() {
  const { preference, resolvedScheme, updateTheme, loading } = useTheme();

  const isDark = resolvedScheme === 'dark';
  const c = isDark ? DARK : LIGHT;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>

      {/* ── Appearance ──────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: c.secondary }]}>APPEARANCE</Text>
      <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>
        {THEME_OPTIONS.map(({ value, label, description }, index) => {
          const isSelected = preference === value;
          const isLast = index === THEME_OPTIONS.length - 1;
          return (
            <TouchableOpacity
              key={value}
              style={[
                styles.row,
                !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
              ]}
              onPress={() => updateTheme(value)}
              activeOpacity={0.7}
              disabled={loading}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled: loading }}
              accessibilityLabel={`${label} theme: ${description}`}
            >
              <View style={styles.rowLeft}>
                <Text style={[styles.rowLabel, { color: c.label }]}>{label}</Text>
                <Text style={[styles.rowDescription, { color: c.secondary }]}>{description}</Text>
              </View>
              {isSelected && (
                <Text style={[styles.checkmark, { color: c.accent }]}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Account ─────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: c.secondary }]}>ACCOUNT</Text>
      <View style={[styles.section, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => supabase.auth.signOut()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={[styles.rowLabel, { color: c.danger }]}>Sign Out</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

// ── Color palettes ───────────────────────────────────────────────

const DARK = {
  background: '#0d0d0d',
  surface:    '#1c1c1e',
  label:      '#f2f2f2',
  secondary:  '#8e8e93',
  border:     '#2c2c2e',
  accent:     '#0a84ff',
  danger:     '#ff453a',
};

const LIGHT = {
  background: '#f2f2f7',
  surface:    '#ffffff',
  label:      '#1c1c1e',
  secondary:  '#6c6c70',
  border:     '#d1d1d6',
  accent:     '#007aff',
  danger:     '#ff3b30',
};

// ── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 52,
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '400',
  },
  rowDescription: {
    fontSize: 13,
  },
  checkmark: {
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 12,
  },
});
