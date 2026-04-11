import { StyleSheet, Text, View } from 'react-native';
import { scoreColor } from '../lib/eventUtils';

interface TrustRingProps {
  score: number;
  /** 'sm' for cards (~38px), 'md' for detail screen (~52px). Default: 'sm'. */
  size?: 'sm' | 'md';
}

const SIZE_CONFIG = {
  sm: { diameter: 38, strokeWidth: 3, fontSize: 11 },
  md: { diameter: 52, strokeWidth: 3.5, fontSize: 14 },
};

/**
 * Compact circular trust score indicator.
 * Renders as a color-coded ring (red/amber/green) with the numeric score inside.
 * Pure View-based — no SVG dependency required.
 *
 * Note: this uses a solid border ring (not a partial arc fill). The color alone
 * communicates the score tier; the exact value is shown as text in the center.
 */
export function TrustRing({ score, size = 'sm' }: TrustRingProps) {
  const { diameter, strokeWidth, fontSize } = SIZE_CONFIG[size];
  const color = scoreColor(score);
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
      accessibilityRole="text"
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
