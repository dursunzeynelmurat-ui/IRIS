import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useUserSignal } from '../hooks/useUserSignal';
import { Event, EventStatus, SignalType } from '../types';

// ── Helpers ───────────────────────────────────────────────────

const STATUS_LABEL: Record<EventStatus, string> = {
  emerging:   'Emerging',
  developing: 'Developing',
  verified:   'Verified',
  disputed:   'Disputed',
};

const STATUS_COLOR: Record<EventStatus, string> = {
  emerging:   '#ff9f0a',
  developing: '#0a84ff',
  verified:   '#30d158',
  disputed:   '#ff453a',
};

function scoreColor(score: number): string {
  if (score >= 67) return '#30d158';
  if (score >= 34) return '#ff9f0a';
  return '#ff453a';
}

// ── Component ─────────────────────────────────────────────────

interface EventCardProps {
  event: Event;
  userId: string | null;
  onPress: () => void;
}

export function EventCard({ event, userId, onPress }: EventCardProps) {
  // useUserSignal fetches the existing vote from DB on mount, so vote state
  // survives navigation — it's not just ephemeral local state.
  const { currentSignal, submitting, submitSignal } = useUserSignal(
    event.id,
    userId,
  );

  const statusColor  = STATUS_COLOR[event.status] ?? '#888';
  const trustScore   = event.trust_score ?? 50;
  const barColor     = scoreColor(trustScore);

  function voteButton(type: SignalType) {
    const isConfirm  = type === 'confirm';
    const isSelected = currentSignal === type;
    const isOther    = currentSignal !== null && currentSignal !== type;

    return (
      <TouchableOpacity
        style={[
          styles.actionBtn,
          isConfirm
            ? isSelected ? styles.confirmActive : styles.confirmIdle
            : isSelected ? styles.disputeActive  : styles.disputeIdle,
          isOther && styles.btnFaded,
        ]}
        onPress={() => submitSignal(type)}
        // Disable the already-selected button and both while submitting
        disabled={!!(isSelected || submitting || !userId)}
        activeOpacity={0.8}
      >
        {submitting && isSelected ? (
          <ActivityIndicator
            size="small"
            color={isConfirm ? '#30d158' : '#ff453a'}
          />
        ) : (
          <Text
            style={[
              styles.actionText,
              isSelected && (isConfirm ? styles.confirmActiveText : styles.disputeActiveText),
            ]}
          >
            {isConfirm ? '✓  Confirm' : '✗  Dispute'}
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
    >
      {/* Title */}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {event.title}
      </Text>

      {/* Status badge + trust score */}
      <View style={styles.cardMeta}>
        <View style={[styles.badge, { borderColor: statusColor }]}>
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
    borderLeftWidth: 3,
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
    height: 4,
    backgroundColor: '#2c2c2e',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 14,
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 2,
  },

  // ── Action buttons ──
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  confirmIdle: {
    borderColor: '#30d158',
    backgroundColor: 'transparent',
  },
  confirmActive: {
    borderColor: '#30d158',
    backgroundColor: '#30d158',
  },
  disputeIdle: {
    borderColor: '#ff453a',
    backgroundColor: 'transparent',
  },
  disputeActive: {
    borderColor: '#ff453a',
    backgroundColor: '#ff453a',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',
  },
  confirmActiveText: {
    color: '#fff',
  },
  disputeActiveText: {
    color: '#fff',
  },
  btnFaded: {
    opacity: 0.3,
  },
});
