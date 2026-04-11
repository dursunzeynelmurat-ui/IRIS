import { StyleSheet, Text, View } from 'react-native';
import { scoreColor } from '../lib/eventUtils';

interface TrustRingProps {
  score: number;
  /** 'sm' (~38px, for feed cards); 'md' (~52px, for detail screen). Default: 'sm'. */
  size?: 'sm' | 'md';
}

const SIZE_CONFIG = {
  sm: { diameter: 38, strokeWidth: 3,   fontSize: 11 },
  md: { diameter: 52, strokeWidth: 3.5, fontSize: 14 },
};

/**
 * Compact circular trust score indicator.
 *
 * Renders a color-coded ring (red/amber/green) around the numeric score.
 * Pure View-based — no SVG dependency needed.
 *
 * The ring uses a solid colored border: the color communicates the tier
 * (red < 34, amber 34–66, green ≥ 67) and the number shows the exact value.
 * This is intentionally simpler than a partial-arc fill: legible at small sizes,
 * unambiguous in all themes, and works without an SVG library.
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
