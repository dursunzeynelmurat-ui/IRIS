import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SignalType } from '../types';

interface SignalButtonProps {
  type: SignalType;
  active: boolean;
  /** Show a spinner on this button while this specific signal is submitting. */
  loading: boolean;
  disabled: boolean;
  /** Dim when the other signal type is active. */
  faded?: boolean;
  /** 'default' — full-size for detail screen; 'compact' — small pill for feed cards. */
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
  const accentColor = type === 'confirm' ? '#30d158' : '#e5193e';
  const label       = type === 'confirm' ? 'Confirm' : 'Dispute';
  const icon        = type === 'confirm' ? '✓' : '✕';

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
    borderRadius: 20, // pill shape
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

  // Compact variant (feed cards — fixed width, smaller padding)
  btnCompact: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    minHeight: 30,
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
