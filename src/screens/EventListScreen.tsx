import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useEvents } from '../hooks/useEvents';
import { Event, EventStatus } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventList'>;

// ── Constants ─────────────────────────────────────────────────

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

// ── EventCard ─────────────────────────────────────────────────

interface EventCardProps {
  event: Event;
  onPress: () => void;
}

function EventCard({ event, onPress }: EventCardProps) {
  const statusColor = STATUS_COLOR[event.status] ?? '#888';
  const barColor    = scoreColor(event.trust_score);

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

      {/* Status + score row */}
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

      {/* Action buttons — placeholder, wired up in Phase 4 */}
      <View style={styles.actions}>
        <TouchableOpacity style={[styles.actionBtn, styles.confirmBtn]}>
          <Text style={styles.confirmText}>✓  Confirm</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.disputeBtn]}>
          <Text style={styles.disputeText}>✗  Dispute</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────

export function EventListScreen({ navigation }: Props) {
  const { events, loading, error, refetch } = useEvents();
  const { userId } = useAuth();

  useEffect(() => {
    if (!userId) return;
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => supabase.auth.signOut()}
          style={styles.signOutBtn}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, userId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Unable to load events.</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={refetch}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={events}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <EventCard
          event={item}
          onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
        />
      )}
      contentContainerStyle={
        events.length === 0 ? styles.centered : styles.listContent
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No events yet.</Text>
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  listContent: {
    padding: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d0d',
    padding: 24,
  },
  separator: {
    height: 10,
  },

  // ── Card ──
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
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  confirmBtn: {
    borderColor: '#30d158',
    backgroundColor: '#30d15815',
  },
  confirmText: {
    color: '#30d158',
    fontSize: 13,
    fontWeight: '600',
  },
  disputeBtn: {
    borderColor: '#ff453a',
    backgroundColor: '#ff453a15',
  },
  disputeText: {
    color: '#ff453a',
    fontSize: 13,
    fontWeight: '600',
  },

  // ── States ──
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f2f2f2',
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    color: '#f2f2f2',
  },
  emptyText: {
    fontSize: 15,
    color: '#8e8e93',
  },
  signOutBtn: {
    marginRight: 4,
  },
  signOutText: {
    fontSize: 14,
    color: '#ff453a',
  },
});
