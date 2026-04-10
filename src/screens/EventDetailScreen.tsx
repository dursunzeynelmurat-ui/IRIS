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
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { STATUS_COLOR, STATUS_LABEL, scoreColor } from '../lib/eventUtils';
import { EventUpdate, SignalType } from '../types';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'EventDetail'>;

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
    <View style={styles.updateRow}>
      {/* Timeline gutter: dot + connector line */}
      <View style={styles.timelineGutter}>
        <View style={styles.timelineDot} />
        <View style={styles.timelineConnector} />
      </View>

      {/* Update content */}
      <View style={styles.updateBody}>
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
        <Text style={styles.updateDate}>{formatRelativeTime(update.created_at)}</Text>
      </View>
    </View>
  );
}

interface SignalButtonProps {
  label: string;
  type: SignalType;
  active: boolean;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}

function SignalButton({ label, type, active, loading, disabled, onPress }: SignalButtonProps) {
  const accentColor = type === 'confirm' ? '#30d158' : '#ff453a';
  return (
    <TouchableOpacity
      style={[
        styles.signalBtn,
        { borderColor: accentColor },
        active && { backgroundColor: accentColor },
      ]}
      onPress={onPress}
      disabled={!!disabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={[styles.signalBtnText, { color: active ? '#fff' : accentColor }]}>
          {label}
        </Text>
      )}
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
  const { currentSignal, fetchLoading, submitting, error, submitSignal } = useUserSignal(
    eventId,
    userId,
  );

  return (
    <View style={styles.signalSection}>
      <View style={styles.signalButtons}>
        {fetchLoading ? (
          // Inert placeholder shapes while the initial signal fetch is in-flight.
          // Prevents the idle-color → active-fill flash on navigation.
          <>
            <View style={[styles.signalBtn, styles.signalBtnPlaceholder]} />
            <View style={[styles.signalBtn, styles.signalBtnPlaceholder]} />
          </>
        ) : (
          <>
            <SignalButton
              label="Confirm"
              type="confirm"
              active={!!(currentSignal === 'confirm')}
              loading={!!(submitting && currentSignal === 'confirm')}
              disabled={!!submitting}
              onPress={() => submitSignal('confirm')}
            />
            <SignalButton
              label="Dispute"
              type="dispute"
              active={!!(currentSignal === 'dispute')}
              loading={!!(submitting && currentSignal === 'dispute')}
              disabled={!!submitting}
              onPress={() => submitSignal('dispute')}
            />
          </>
        )}
      </View>
      {!fetchLoading && error && <Text style={styles.signalError}>{error}</Text>}
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
  const statusColor = STATUS_COLOR[event.status] ?? '#888';
  const trustScore  = event.trust_score ?? 50;
  const barColor    = scoreColor(trustScore);

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

          {/* Status badge + source count */}
          <View style={styles.metaRow}>
            <View style={[styles.badge, { borderColor: statusColor }]}>
              <Text style={[styles.badgeText, { color: statusColor }]}>
                {STATUS_LABEL[event.status] ?? event.status}
              </Text>
            </View>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaDetail}>{sourceLabel}</Text>
          </View>

          {/* Trust score label + bar */}
          <Text style={styles.scoreLabel}>
            Trust{' '}
            <Text style={[styles.scoreValue, { color: barColor }]}>{trustScore}</Text>
            <Text style={styles.scoreMax}>/100</Text>
          </Text>
          <View style={styles.scoreBarBg}>
            <View
              style={[
                styles.scoreBarFill,
                { width: `${trustScore}%`, backgroundColor: barColor },
              ]}
            />
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
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No updates yet.</Text>
          <Text style={styles.emptyHint}>Pull down to refresh.</Text>
        </View>
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

  // ── Header ──
  header: {
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f2f2f2',
    lineHeight: 30,
    marginBottom: 10,
  },

  // ── Status badge + meta row ──
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    flexWrap: 'wrap',
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
  metaDot: {
    fontSize: 13,
    color: '#3a3a3c',
  },
  metaDetail: {
    fontSize: 13,
    color: '#8e8e93',
  },

  // ── Trust score ──
  scoreLabel: {
    fontSize: 13,
    color: '#8e8e93',
    marginBottom: 6,
  },
  scoreValue: {
    fontWeight: '700',
    fontSize: 14,
  },
  scoreMax: {
    color: '#8e8e93',
    fontSize: 13,
  },
  scoreBarBg: {
    height: 5,
    backgroundColor: '#2c2c2e',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 20,
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // ── Signal section ──
  signalSection: {
    marginBottom: 24,
  },
  signalButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  signalBtn: {
    flex: 1,
    paddingVertical: 11,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  signalBtnPlaceholder: {
    borderColor: '#2c2c2e',
  },
  signalBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  signalError: {
    marginTop: 8,
    fontSize: 12,
    color: '#ff453a',
  },

  // ── Section label ──
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#636366',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 16,
  },

  // ── Timeline items ──
  updateRow: {
    flexDirection: 'row',
  },
  timelineGutter: {
    width: 22,
    alignItems: 'center',
    paddingTop: 2,
  },
  timelineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#3a3a3c',
  },
  timelineConnector: {
    flex: 1,
    width: 1,
    backgroundColor: '#2c2c2e',
    marginTop: 5,
  },
  updateBody: {
    flex: 1,
    paddingBottom: 20,
    paddingLeft: 2,
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

  // ── Empty / error ──
  emptyContainer: {
    paddingTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#8e8e93',
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 12,
    color: '#636366',
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f2f2f2',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 8,
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
