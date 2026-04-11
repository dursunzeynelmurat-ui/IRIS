import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SignalButton } from './SignalButton';
import { StatusBadge } from './StatusBadge';
import { TrustRing } from './TrustRing';
import { useTheme } from '../context/ThemeContext';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { STATUS_LABEL } from '../lib/eventUtils';
import { castSignal } from '../services/signalService';
import { Event, SignalType } from '../types';

// ── Component ─────────────────────────────────────────────────

interface EventCardProps {
  event: Event;
  userId: string;                   // always non-null — list screen is auth-gated
  initialSignal: SignalType | null; // pre-seeded by bulk fetch in EventListScreen
  onSignalCast: (type: SignalType) => void; // notifies parent to keep map current
  onPress: () => void;
}

export function EventCard({
  event,
  userId,
  initialSignal,
  onSignalCast,
  onPress,
}: EventCardProps) {
  const { colors } = useTheme();

  // Signal state is seeded from the bulk fetch — no per-card DB query.
  const [currentSignal, setCurrentSignal] = useState<SignalType | null>(initialSignal);
  const [submitting, setSubmitting] = useState(false);

  // hasLocalSubmit tracks whether the user has interacted with THIS card in the
  // current mount. Before any local submit, initialSignal changes (e.g. when the
  // parent's bulk fetch resolves after the FlatList has already rendered) are
  // synced into local state. Once the user has submitted, local state is
  // authoritative and prop changes are ignored to preserve optimistic updates.
  const hasLocalSubmit = useRef(false);

  useEffect(() => {
    if (!hasLocalSubmit.current) {
      setCurrentSignal(initialSignal);
    }
  }, [initialSignal]);

  const trustScore = event.trust_score ?? 50;

  async function submitSignal(type: SignalType) {
    if (type === currentSignal) return;
    if (submitting) return;
    hasLocalSubmit.current = true;

    const previous = currentSignal;
    setCurrentSignal(type); // optimistic update
    setSubmitting(true);

    try {
      await castSignal(userId, event.id, type);
      onSignalCast(type);
    } catch (err) {
      console.error('[EventCard] castSignal:', err);
      setCurrentSignal(previous); // revert
      hasLocalSubmit.current = false;
    }

    setSubmitting(false);
  }

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${STATUS_LABEL[event.status] ?? event.status}`}
      accessibilityHint="Opens event details"
    >
      {/* Title */}
      <Text style={[styles.cardTitle, { color: colors.textPrimary }]} numberOfLines={2}>
        {event.title}
      </Text>

      {/* Status badge + trust ring */}
      <View style={styles.cardMeta}>
        <StatusBadge status={event.status} />
        <View style={styles.metaSpacer} />
        <TrustRing score={trustScore} size="sm" />
      </View>

      {/* Source count + age */}
      <View style={styles.cardFooter}>
        <Text style={[styles.footerDetail, { color: colors.textTertiary }]}>
          {event.source_count === 1 ? '1 source' : `${event.source_count} sources`}
        </Text>
        <Text style={[styles.footerDot, { color: colors.borderStrong }]}>·</Text>
        <Text style={[styles.footerDetail, { color: colors.textTertiary }]}>
          {formatRelativeTime(event.created_at)}
        </Text>
      </View>

      {/* Divider */}
      <View style={[styles.actionsDivider, { backgroundColor: colors.border }]} />

      {/* Signal pills */}
      <View style={styles.actions}>
        {(['confirm', 'dispute'] as SignalType[]).map((type) => {
          const isSelected = currentSignal === type;
          return (
            <SignalButton
              key={type}
              type={type}
              size="compact"
              active={isSelected}
              loading={!!(submitting && isSelected)}
              disabled={!!(isSelected || submitting)}
              faded={!!(currentSignal !== null && !isSelected)}
              onPress={() => submitSignal(type)}
            />
          );
        })}
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 12,
  },

  // ── Meta row (badge + ring) ──
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  metaSpacer: {
    flex: 1,
  },

  // ── Footer ──
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  footerDetail: {
    fontSize: 11,
  },
  footerDot: {
    fontSize: 11,
  },

  // ── Signal row ──
  actionsDivider: {
    height: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
});
