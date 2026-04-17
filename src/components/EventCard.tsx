import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { statusColors, scoreColor, STATUS_LABEL } from '../lib/eventUtils';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { Event } from '../types';

// ── Component ─────────────────────────────────────────────────
// Cards are entry points — not action surfaces.
// No signal buttons on cards; signals live only on the detail screen.

interface EventCardProps {
  event: Event;
  onPress: () => void;
}

export function EventCard({ event, onPress }: EventCardProps) {
  const { colors, resolved } = useTheme();

  const trustScore   = event.trust_score ?? 50;
  const trustColor   = scoreColor(trustScore, resolved);
  const statusColor  = statusColors(resolved)[event.status];
  const statusLabel  = STATUS_LABEL[event.status] ?? event.status;
  const sourceCount  = event.source_count ?? 0;
  // Use latest_update_at when available — shows when the event was last active,
  // not just when it was first ingested.
  const time         = formatRelativeTime(event.latest_update_at ?? event.created_at);

  const placeholderTint = statusColor + '18';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.bgElevated,
          borderColor: colors.border,
          shadowColor: colors.textPrimary,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${statusLabel}, Trust ${trustScore}`}
      accessibilityHint="Opens event details"
    >
      {/* ── Hero image area ── */}
      {event.image_url ? (
        <Image
          source={{ uri: event.image_url }}
          style={styles.heroImage}
          resizeMode="cover"
          accessibilityLabel="Event photo"
        />
      ) : (
        <View style={[styles.heroPlaceholder, { backgroundColor: placeholderTint }]} />
      )}

      {/* ── Text content ── */}
      <View style={styles.content}>
        {/* Title — primary editorial element */}
        <Text
          style={[styles.title, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {event.title}
        </Text>

        {/* Summary — one-line context when available */}
        {!!event.summary && (
          <Text
            style={[styles.summary, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {event.summary}
          </Text>
        )}

        {/* Metadata row: Trust N • Status • Time */}
        <View style={styles.metaRow}>
          <Text style={[styles.metaTrust, { color: trustColor }]}>
            Trust {trustScore}
          </Text>
          <Text style={[styles.metaSep, { color: colors.textTertiary }]}> • </Text>
          <Text style={[styles.metaStatus, { color: statusColor }]}>
            {statusLabel}
          </Text>
          <Text style={[styles.metaSep, { color: colors.textTertiary }]}> • </Text>
          <Text style={[styles.metaTime, { color: colors.textTertiary }]}>
            {time}
          </Text>
        </View>

        {/* Source count — quiet line below metadata */}
        {sourceCount > 0 && (
          <Text style={[styles.sources, { color: colors.textTertiary }]}>
            {sourceCount === 1 ? '1 source' : `${sourceCount} sources`}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },

  // ── Image area ──
  heroImage: {
    width: '100%',
    height: 176,
  },
  heroPlaceholder: {
    width: '100%',
    height: 140,
  },

  // ── Content area ──
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 4,
  },

  // ── Title ──
  title: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
    letterSpacing: -0.2,
    marginBottom: 2,
  },

  // ── Summary ──
  summary: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },

  // ── Metadata row ──
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  metaTrust: {
    fontSize: 13,
    fontWeight: '600',
  },
  metaSep: {
    fontSize: 13,
  },
  metaStatus: {
    fontSize: 13,
    fontWeight: '600',
  },
  metaTime: {
    fontSize: 13,
  },

  // ── Source count ──
  sources: {
    fontSize: 12,
    marginTop: 2,
  },
});
