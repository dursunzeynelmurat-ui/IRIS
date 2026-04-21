import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { SignalType } from '../types';

interface SignalButtonProps {
  type: SignalType;
  active: boolean;
  loading: boolean;
  disabled: boolean;
  faded?: boolean;
  /**
   * 'default' — full-width pill for the detail screen (flex: 1 from parent row).
   * 'compact' — self-sized pill, narrower padding.
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
  const { colors, resolved } = useTheme();

  // Confirm: green (semantic — agreement/trust).
  // Dispute: danger/red (semantic — disagreement/flag). Never the brand blue.
  const confirmColor = resolved === 'dark' ? '#30D158' : '#1E7A30';
  const accentColor  = type === 'confirm' ? confirmColor : colors.danger;

  const label    = type === 'confirm' ? 'Confirm' : 'Dispute';
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
          {label}
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

  btnDefault: {
    flex: 1,
    paddingVertical: 12,
    minHeight: 44,
  },
  textDefault: {
    fontSize: 15,
    fontWeight: '600',
  },

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
