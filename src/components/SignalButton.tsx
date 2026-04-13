import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { SignalType } from '../types';

interface SignalButtonProps {
  type: SignalType;
  active: boolean;
  /** Show a spinner on this button while this specific signal is submitting. */
  loading: boolean;
  disabled: boolean;
  /** Dim when the other signal type is active. */
  faded?: boolean;
  /**
   * 'default' — full-width pill for the detail screen (flex: 1 from parent row).
   * 'compact' — self-sized pill for feed cards (narrower padding, shorter height).
   */
  size?: 'default' | 'compact';
  onPress: () => void;
}

export function SignalButton({
  type,
  active,
  loading,
  disabled,
  faded = false,
  size = 'default',
  onPress,
}: SignalButtonProps) {
  const { resolved, colors } = useTheme();

  // Confirm: green — WCAG-compliant in both themes.
  // Dispute: IRIS red — brand color, theme-aware.
  const confirmColor = resolved === 'dark' ? '#30d158' : '#1e7a30';
  const accentColor  = type === 'confirm' ? confirmColor : colors.iris;

  const label    = type === 'confirm' ? 'Confirm' : 'Dispute';
  const icon     = type === 'confirm' ? '✓' : '✕';
  const isCompact = size === 'compact';

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        isCompact ? styles.btnCompact : styles.btnDefault,
        { borderColor: accentColor },
        active && { backgroundColor: accentColor },
        faded && styles.faded,
      ]}
      onPress={onPress}
      disabled={!!disabled}
      activeOpacity={0.8}
      // Extend touch area on compact pills to meet iOS 44pt minimum.
      hitSlop={isCompact ? { top: 8, bottom: 8, left: 6, right: 6 } : undefined}
      accessibilityRole="button"
      accessibilityLabel={`${label} event`}
      accessibilityState={{ selected: active, disabled: !!disabled }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={active ? '#fff' : accentColor}
        />
      ) : (
        <Text
          style={[
            isCompact ? styles.textCompact : styles.textDefault,
            { color: active ? '#fff' : accentColor },
          ]}
        >
          {isCompact ? `${icon} ${label}` : label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Full-size variant (detail screen — takes flex: 1 from parent row)
  btnDefault: {
    flex: 1,
    paddingVertical: 10,
    minHeight: 40,
  },
  textDefault: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Compact variant (feed cards).
  // Visual size is small (~32px tall) but hitSlop extends touch target to 44pt+.
  btnCompact: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    minHeight: 32,
  },
  textCompact: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },

  faded: {
    opacity: 0.35,
  },
});
