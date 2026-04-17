import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scoreColor } from '../lib/eventUtils';

interface TrustRingProps {
  score: number;
  /** 'sm' (~38px, feed cards); 'md' (~52px, detail meta); 'lg' (~64px, trust summary card). Default: 'sm'. */
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CONFIG = {
  sm: { diameter: 38, strokeWidth: 3,   fontSize: 11 },
  md: { diameter: 52, strokeWidth: 3.5, fontSize: 14 },
  lg: { diameter: 64, strokeWidth: 4.5, fontSize: 20 },
};

/**
 * Compact circular trust score indicator.
 *
 * Renders a color-coded ring (red/amber/green) around the numeric score.
 * Pure View-based — no SVG dependency needed.
 *
 * The ring uses a solid colored border: the color communicates the tier
 * (red < 34, amber 34–66, green ≥ 67) and the number shows the exact value.
 * Both color and number are theme-aware (WCAG-compliant in light mode).
 */
export function TrustRing({ score, size = 'sm' }: TrustRingProps) {
  const { resolved } = useTheme();
  const { diameter, strokeWidth, fontSize } = SIZE_CONFIG[size];
  const color = scoreColor(score, resolved);
  const borderRadius = diameter / 2;

  return (
    <View
      style={[
        styles.ring,
        {
          width: diameter,
          height: diameter,
          borderRadius,
          borderWidth: strokeWidth,
          borderColor: color,
        },
      ]}
      accessibilityLabel={`Trust score ${score} out of 100`}
    >
      <Text style={[styles.score, { fontSize, color }]} numberOfLines={1}>
        {score}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: {
    fontWeight: '700',
    letterSpacing: -0.5,
  },
});
