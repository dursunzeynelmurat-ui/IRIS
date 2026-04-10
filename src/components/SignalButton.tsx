import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SignalType } from '../types';

interface SignalButtonProps {
  type: SignalType;
  active: boolean;
  /** Show a spinner on this button (pass true while submitting this specific signal). */
  loading: boolean;
  disabled: boolean;
  /** Dim this button when the other signal type is currently active. */
  faded?: boolean;
  onPress: () => void;
}

export function SignalButton({
  type,
  active,
  loading,
  disabled,
  faded = false,
  onPress,
}: SignalButtonProps) {
  const accentColor = type === 'confirm' ? '#30d158' : '#ff453a';
  const label       = type === 'confirm' ? 'Confirm' : 'Dispute';

  return (
    <TouchableOpacity
      style={[
        styles.btn,
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
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={[styles.text, { color: active ? '#fff' : accentColor }]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
  faded: {
    opacity: 0.35,
  },
});
