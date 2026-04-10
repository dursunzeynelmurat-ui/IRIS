import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { STATUS_COLOR, STATUS_LABEL, scoreColor } from '../lib/eventUtils';
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
  // Signal state is seeded from the bulk fetch — no per-card DB query.
  const [currentSignal, setCurrentSignal] = useState<SignalType | null>(initialSignal);
  const [submitting, setSubmitting] = useState(false);

  // hasLocalSubmit tracks whether the user has interacted with THIS card in the
  // current mount. Before any local submit, initialSignal changes (e.g. when the
  // parent's bulk fetch resolves after the FlatList has already rendered) are
  // synced into local state. Once the user has submitted, local state is
  // authoritative and prop changes are ignored to preserve optimistic updates.
  // The ref resets on unmount, so remounts re-accept the (now-current) parent value.
  const hasLocalSubmit = useRef(false);

  useEffect(() => {
    if (!hasLocalSubmit.current) {
      setCurrentSignal(initialSignal);
    }
  }, [initialSignal]);

  const statusColor = STATUS_COLOR[event.status] ?? '#888';
  const trustScore  = event.trust_score ?? 50;
  const barColor    = scoreColor(trustScore);

  async function submitSignal(type: SignalType) {
    if (type === currentSignal) return; // no-op: already active
    if (submitting) return;
    hasLocalSubmit.current = true; // local state is authoritative from here on

    const previous = currentSignal;
    setCurrentSignal(type); // optimistic update
    setSubmitting(true);

    try {
      await castSignal(userId, event.id, type);
      onSignalCast(type); // keep parent map current for remount consistency
    } catch (err) {
      console.error('[EventCard] castSignal:', err);
      setCurrentSignal(previous); // revert on failure
      hasLocalSubmit.current = false; // allow initialSignal sync again — no local change persisted
    }

    setSubmitting(false);
  }

  function voteButton(type: SignalType) {
    const isConfirm   = type === 'confirm';
    const isSelected  = currentSignal === type;
    const isOther     = currentSignal !== null && currentSignal !== type;
    const accentColor = isConfirm ? '#30d158' : '#ff453a';

    return (
      <TouchableOpacity
        style={[
          styles.actionBtn,
          { borderColor: accentColor },
          isSelected && { backgroundColor: accentColor },
          isOther && styles.btnFaded,
        ]}
        onPress={() => submitSignal(type)}
        disabled={!!(isSelected || submitting)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={isConfirm ? 'Confirm event' : 'Dispute event'}
        accessibilityState={{ selected: isSelected, disabled: !!(isSelected || submitting) }}
      >
        {submitting && isSelected ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={[styles.actionText, { color: isSelected ? '#fff' : accentColor }]}>
            {isConfirm ? 'Confirm' : 'Dispute'}
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: statusColor }]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${STATUS_LABEL[event.status] ?? event.status}`}
      accessibilityHint="Opens event details"
    >
      {/* Title */}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {event.title}
      </Text>

      {/* Status badge + trust score */}
      <View style={styles.cardMeta}>
        <View style={[styles.badge, { borderColor: statusColor, backgroundColor: statusColor + '18' }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>
            {STATUS_LABEL[event.status] ?? event.status}
          </Text>
        </View>
        <Text style={styles.scoreLabel}>
          Trust{' '}
          <Text style={[styles.scoreValue, { color: barColor }]}>
            {trustScore}
          </Text>
          <Text style={styles.scoreMax}>/100</Text>
        </Text>
      </View>

      {/* Trust score bar */}
      <View style={styles.scoreBarBg}>
        <View
          style={[
            styles.scoreBarFill,
            { width: `${trustScore}%`, backgroundColor: barColor },
          ]}
        />
      </View>

      {/* Source count + age */}
      <View style={styles.cardFooter}>
        <Text style={styles.sourceCount}>
          {event.source_count === 1 ? '1 source' : `${event.source_count} sources`}
        </Text>
        <Text style={styles.cardAge}>{formatRelativeTime(event.created_at)}</Text>
      </View>

      {/* Divider: separates content area from signal actions */}
      <View style={styles.actionsDivider} />

      {/* Signal buttons */}
      <View style={styles.actions}>
        {voteButton('confirm')}
        {voteButton('dispute')}
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f2f2f2',
    marginBottom: 10,
    lineHeight: 22,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scoreLabel: {
    fontSize: 13,
    color: '#8e8e93',
  },
  scoreValue: {
    fontWeight: '700',
    fontSize: 14,
  },
  scoreMax: {
    color: '#8e8e93',
    fontSize: 13,
  },

  // ── Score bar ──
  scoreBarBg: {
    height: 5,
    backgroundColor: '#2c2c2e',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 14,
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // ── Footer ──
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sourceCount: {
    fontSize: 11,
    color: '#636366',
  },
  cardAge: {
    fontSize: 11,
    color: '#636366',
  },

  // ── Signal buttons ──
  actionsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2c2c2e',
    marginBottom: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  btnFaded: {
    opacity: 0.35,
  },
});
