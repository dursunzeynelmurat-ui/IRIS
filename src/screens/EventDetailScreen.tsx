import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useEventDetail } from '../hooks/useEventDetail';
import { useUserSignal } from '../hooks/useUserSignal';
import { EventUpdate, SignalType } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

// ── Helpers ───────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

// ── Sub-components ────────────────────────────────────────────

function UpdateItem({ update }: { update: EventUpdate }) {
  const hasLink = !!update.source_url;

  function openLink() {
    if (!update.source_url) return;
    try {
      Linking.openURL(update.source_url);
    } catch {
      // ignore malformed URL
    }
  }

  return (
    <View style={styles.updateItem}>
      {hasLink ? (
        <TouchableOpacity onPress={openLink} activeOpacity={0.7}>
          <Text style={[styles.updateSource, styles.updateSourceLink]}>
            {update.source_name} ↗
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.updateSource}>{update.source_name}</Text>
      )}
      <Text style={styles.updateContent}>{update.content}</Text>
      <Text style={styles.updateDate}>{formatDate(update.created_at)}</Text>
    </View>
  );
}

interface SignalButtonProps {
  label: string;
  type: SignalType;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
}

function SignalButton({ label, active, disabled, onPress }: SignalButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.signalBtn, !!active && styles.signalBtnActive]}
      onPress={onPress}
      disabled={!!disabled}
    >
      <Text style={[styles.signalBtnText, active && styles.signalBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface SignalSectionProps {
  eventId: string;
  // userId is always non-null here: App.tsx only renders the navigator when
  // userId !== null, so EventDetailScreen is unreachable while unauthenticated.
  userId: string;
}

function SignalSection({ eventId, userId }: SignalSectionProps) {
  const { currentSignal, submitting, error, submitSignal } = useUserSignal(
    eventId,
    userId,
  );

  return (
    <View style={styles.signalSection}>
      <View style={styles.signalButtons}>
        <SignalButton
          label="Confirm"
          type="confirm"
          active={!!(currentSignal === 'confirm')}
          disabled={!!submitting}
          onPress={() => submitSignal('confirm')}
        />
        <SignalButton
          label="Dispute"
          type="dispute"
          active={!!(currentSignal === 'dispute')}
          disabled={!!submitting}
          onPress={() => submitSignal('dispute')}
        />
      </View>
      {error && <Text style={styles.signalError}>{error}</Text>}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────

export function EventDetailScreen({ route, navigation }: Props) {
  const eventId = route.params?.eventId;
  const { event, updates, loading, error, refetch } = useEventDetail(eventId ?? '');
  const { userId } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // Dynamic header: event title + sign-out button
  useEffect(() => {
    navigation.setOptions({
      title: event?.title ?? 'Event Detail',
      headerRight: () => (
        <TouchableOpacity
          onPress={() => supabase.auth.signOut()}
          style={styles.signOutBtn}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      ),
    });
  }, [event?.title, navigation]);

  async function handleRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  if (!eventId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Unable to load event.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Unable to load event.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refetch}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sourceLabel = event.source_count === 1 ? '1 source' : `${event.source_count} sources`;

  return (
    <FlatList
      style={styles.screen}
      data={updates}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <UpdateItem update={item} />}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor="#8e8e93"
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>{event.title}</Text>
          <View style={styles.meta}>
            <Text style={styles.metaText}>{event.status}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>Trust: {event.trust_score}/100</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{sourceLabel}</Text>
          </View>

          {userId && (
            <SignalSection
              eventId={event.id}
              userId={userId}
            />
          )}

          <Text style={styles.sectionLabel}>Timeline</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.emptyText}>No updates yet.</Text>
      }
    />
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0d0d0d',
  },
  list: {
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f2f2f2',
    marginBottom: 8,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 13,
    color: '#8e8e93',
  },
  metaDot: {
    fontSize: 13,
    color: '#3a3a3c',
  },
  signalSection: {
    marginBottom: 20,
  },
  signalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  signalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 6,
  },
  signalBtnActive: {
    backgroundColor: '#f2f2f2',
    borderColor: '#f2f2f2',
  },
  signalBtnText: {
    fontSize: 14,
    color: '#8e8e93',
  },
  signalBtnTextActive: {
    color: '#0d0d0d',
  },
  signalError: {
    marginTop: 6,
    fontSize: 12,
    color: '#ff453a',
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#aeaeb2',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
    paddingBottom: 8,
  },
  updateItem: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  updateSource: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aeaeb2',
    marginBottom: 4,
  },
  updateSourceLink: {
    color: '#0a84ff',
    textDecorationLine: 'underline',
  },
  updateContent: {
    fontSize: 15,
    color: '#f2f2f2',
    lineHeight: 22,
    marginBottom: 6,
  },
  updateDate: {
    fontSize: 11,
    color: '#636366',
  },
  emptyText: {
    fontSize: 14,
    color: '#8e8e93',
    marginTop: 12,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f2f2f2',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 6,
  },
  retryText: {
    fontSize: 14,
    color: '#f2f2f2',
  },
  signOutBtn: {
    marginRight: 4,
  },
  signOutText: {
    fontSize: 14,
    color: '#ff453a',
  },
});
