import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { castSignal } from '../services/signalService';
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
  const [userVote, setUserVote]   = useState<SignalType | null>(null);
  const [sending, setSending]     = useState(false);

  const statusColor = STATUS_COLOR[event.status] ?? '#888';
  const barColor    = scoreColor(event.trust_score);
  const voted       = userVote !== null;

  // Both buttons lock once a vote is cast (or while one is in flight)
  const buttonsLocked = voted || sending || !userId;

  async function handleVote(type: SignalType) {
    // Prevent double-vote and no-op on re-tap of same button
    if (!userId || voted || sending) return;

    setSending(true);
    try {
      await castSignal(userId, event.id, type);
      setUserVote(type);
    } catch (err) {
      console.error('[EventCard] vote failed:', err);
      // Buttons recover — no vote recorded locally
    } finally {
      setSending(false);
    }
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
            {event.trust_score}
          </Text>
          <Text style={styles.scoreMax}>/100</Text>
        </Text>
      </View>

      {/* Trust score bar */}
      <View style={styles.scoreBarBg}>
        <View
          style={[
            styles.scoreBarFill,
            { width: `${event.trust_score}%`, backgroundColor: barColor },
          ]}
        />
      </View>

      {/* Signal buttons */}
      <View style={styles.actions}>
        {/* Confirm */}
        <TouchableOpacity
          style={[
            styles.actionBtn,
            userVote === 'confirm' ? styles.confirmActive : styles.confirmIdle,
            buttonsLocked && userVote !== 'confirm' && styles.btnFaded,
          ]}
          onPress={() => handleVote('confirm')}
          disabled={!!(buttonsLocked && userVote !== 'confirm')}
          activeOpacity={0.8}
        >
          {sending && userVote === null ? (
            <ActivityIndicator size="small" color="#30d158" />
          ) : (
            <Text
              style={[
                styles.actionText,
                userVote === 'confirm' && styles.confirmActiveText,
              ]}
            >
              ✓  Confirm
            </Text>
          )}
        </TouchableOpacity>

        {/* Dispute */}
        <TouchableOpacity
          style={[
            styles.actionBtn,
            userVote === 'dispute' ? styles.disputeActive : styles.disputeIdle,
            buttonsLocked && userVote !== 'dispute' && styles.btnFaded,
          ]}
          onPress={() => handleVote('dispute')}
          disabled={!!(buttonsLocked && userVote !== 'dispute')}
          activeOpacity={0.8}
        >
          {sending && userVote === null ? (
            <ActivityIndicator size="small" color="#ff453a" />
          ) : (
            <Text
              style={[
                styles.actionText,
                userVote === 'dispute' && styles.disputeActiveText,
              ]}
            >
              ✗  Dispute
            </Text>
          )}
        </TouchableOpacity>
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

  // Confirm — idle (outlined) vs active (filled)
  confirmIdle: {
    borderColor: '#30d158',
    backgroundColor: 'transparent',
  },
  confirmActive: {
    borderColor: '#30d158',
    backgroundColor: '#30d158',
  },

  // Dispute — idle (outlined) vs active (filled)
  disputeIdle: {
    borderColor: '#ff453a',
    backgroundColor: 'transparent',
  },
  disputeActive: {
    borderColor: '#ff453a',
    backgroundColor: '#ff453a',
  },

  // Text
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8e8e93',  // muted until voted
  },
  confirmActiveText: {
    color: '#fff',
  },
  disputeActiveText: {
    color: '#fff',
  },

  // Dim the un-selected button after voting
  btnFaded: {
    opacity: 0.3,
  },
});
