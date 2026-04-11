import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: 'System', description: 'Follows your device setting' },
  { value: 'light',  label: 'Light',  description: 'Always use light appearance' },
  { value: 'dark',   label: 'Dark',   description: 'Always use dark appearance' },
];

// StatusBar is NOT rendered here — App.tsx already renders one StatusBar for
// the entire NavigationContainer tree. Deep screens inherit that setting.

export function SettingsScreen(_: Props) {
  const { preference, setPreference, colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
        APPEARANCE
      </Text>

      <View
        style={[styles.group, { backgroundColor: colors.bgElevated }]}
        accessibilityRole="radiogroup"
      >
        {THEME_OPTIONS.map(({ value, label, description }, idx) => {
          const isSelected = preference === value;
          const isLast = idx === THEME_OPTIONS.length - 1;

          return (
            <TouchableOpacity
              key={value}
              style={[
                styles.row,
                !isLast && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
              onPress={() => setPreference(value)}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityHint={description}
              accessibilityState={{ checked: isSelected }}
            >
              {/* Radio indicator */}
              <View
                style={[
                  styles.radio,
                  {
                    borderColor: isSelected ? colors.iris : colors.borderStrong,
                  },
                ]}
              >
                {isSelected && (
                  <View style={[styles.radioFill, { backgroundColor: colors.iris }]} />
                )}
              </View>

              <View style={styles.labelGroup}>
                <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
                  {label}
                </Text>
                <Text style={[styles.optionDesc, { color: colors.textTertiary }]}>
                  {description}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingTop: 20,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },

  group: {
    marginBottom: 28,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
    minHeight: 56,
  },

  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  labelGroup: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '400',
  },
  optionDesc: {
    fontSize: 12,
  },
});
